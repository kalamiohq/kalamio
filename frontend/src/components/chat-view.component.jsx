import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UserContext } from "../App";
import { queryKeys } from "../common/queryKeys";
import api from "../common/api";
import { acquireSocket, getSocket, releaseSocket } from "../common/socket";
import { appendMessage, hasHistoryGap, mergeNewestMessages } from "../common/chat-messages";
import MessageBubble from "./message-bubble.component";
import Avatar from "./Avatar";
import Icon from "./Icon";
import toast from "react-hot-toast";

// A message's sender may be a populated object or a bare id string (optimistic sends) — normalise.
const resolveSenderId = (m) => m?.sender?._id || m?.sender;

const ChatView = ({ conversation, onConversationUpdate, onConversationCreated, onRequestAccepted, onRequestDeclined }) => {

    const { userAuth: { _id: currentUserId, access_token, profile_img: myAvatar, fullname: myName } } = useContext(UserContext);
    const queryClient = useQueryClient();

    // Mark a conversation read on the server, then refresh the unread badge + conversation list so
    // the Chat red dot clears live (not only on refresh).
    const markConversationRead = (cid) => {
        api.post("/messages/mark-read", { conversation_id: cid })
            .then(() => {
                queryClient.invalidateQueries({ queryKey: queryKeys.messages.unreadTotal() });
            })
            .catch(() => {});
    };

    const [messages, setMessages] = useState([]);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [requestPending, setRequestPending] = useState(false);

    const messagesEndRef = useRef(null);
    const messagesBoxRef = useRef(null);
    const inputRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    // Id of the newest message we've already auto-scrolled to, so only APPENDS scroll (not prepends).
    const lastMsgIdRef = useRef(null);
    // scrollHeight captured just before older messages are prepended, used to restore the viewport.
    const prependAnchorRef = useRef(null);

    // Which own messages show a read receipt: the last own message, PLUS any own message whose read
    // status differs from the next own message — so a "Read" message followed by a newer "Delivered"
    // one shows both, instead of only "Delivered" under the latest (which reads as if none were read).
    const receiptFlags = useMemo(() => {
        const flags = new Array(messages.length).fill(false);
        let nextOwnRead = null; // read status of the nearest own message AFTER index i
        for (let i = messages.length - 1; i >= 0; i--) {
            if (resolveSenderId(messages[i]) !== currentUserId) continue;
            const r = !!messages[i].read;
            if (nextOwnRead === null || nextOwnRead !== r) flags[i] = true;
            nextOwnRead = r;
        }
        return flags;
    }, [messages, currentUserId]);

    const other = conversation?.other_user;
    const convId = conversation?._id;
    const isNewConv = conversation?._isNew;
    const recipientId = conversation?._recipientId;
    const isRequest = conversation?.type === 'request' && conversation?.request_status === 'pending';
    // Reliably determine if I'm the recipient or sender of this request
    const isRequestSender = isRequest && conversation?.request_initiator?.toString() === currentUserId;
    const isRequestRecipient = isRequest && !isRequestSender;

    // Load messages
    useEffect(() => {
        if (isNewConv) {
            // New conversation — no messages to load
            setMessages([]);
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 200);
            return;
        }

        if (!convId) return;

        setMessages([]);
        setPage(1);
        setLoading(true);

        api.post("/messages", { conversation_id: convId, page: 1 })
        .then(({ data }) => {
            setMessages(data.messages);
            setHasMore(data.messages.length < data.totalDocs);
            setLoading(false);

            // Mark as read
            markConversationRead(convId);
        })
        .catch(() => setLoading(false));

        // Focus input
        setTimeout(() => inputRef.current?.focus(), 200);
    }, [convId, isNewConv]);

    // Socket.IO real-time messages
    useEffect(() => {
        if (!access_token || !convId) return;

        const socket = acquireSocket();
        if (!socket) return;

        let cancelled = false;

        // Nothing is pushed while the socket is down: Cloud Run cuts it every 5 minutes, and it closes
        // when the tab is hidden or idle. So reload the newest page whenever it (re)connects.
        const handleConnect = () => {
            setIsTyping(false); // the stop_typing may have been missed
            api.post("/messages", { conversation_id: convId, page: 1 })
            .then(({ data }) => {
                if (cancelled) return;
                if (hasHistoryGap(messagesRef.current, data.messages)) {
                    setPage(1);
                    setHasMore(data.messages.length < data.totalDocs);
                }
                setMessages(prev => mergeNewestMessages(prev, data.messages));
                if (data.messages.some(m => !m.read && resolveSenderId(m) !== currentUserId)) {
                    markConversationRead(convId);
                }
            })
            .catch(() => {});
        };

        const handleNewMessage = (data) => {
            if (data.conversation_id === convId) {
                setMessages(prev => appendMessage(prev, data.message));
                scrollToBottom();

                // Mark as read immediately since we're in this chat
                markConversationRead(convId);
            }
            // Update conversation list regardless
            onConversationUpdate?.();
        };

        const handleTyping = (data) => {
            if (data.conversation_id === convId) {
                setIsTyping(true);
            }
        };

        const handleStopTyping = (data) => {
            if (data.conversation_id === convId) {
                setIsTyping(false);
            }
        };

        const handleMessagesRead = (data) => {
            if (data.conversation_id === convId) {
                // The other user opened the chat — mark our sent messages read (read receipt).
                setMessages(prev => prev.map(m =>
                    resolveSenderId(m) === currentUserId ? { ...m, read: true } : m
                ));
            }
        };

        socket.on('connect', handleConnect);
        socket.on('new_message', handleNewMessage);
        socket.on('user_typing', handleTyping);
        socket.on('user_stop_typing', handleStopTyping);
        socket.on('messages_read', handleMessagesRead);

        return () => {
            cancelled = true;
            socket.off('connect', handleConnect);
            socket.off('new_message', handleNewMessage);
            socket.off('user_typing', handleTyping);
            socket.off('user_stop_typing', handleStopTyping);
            socket.off('messages_read', handleMessagesRead);
            releaseSocket();
        };
    }, [convId, access_token]);

    // Auto-scroll to bottom on new messages
    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
    };

    // Auto-scroll ONLY when a message is appended at the end. When older messages are prepended by
    // loadMore we instead keep the reader where they were, by re-adding the height that was inserted
    // above them — otherwise loading history instantly yanked them back to the newest message.
    useLayoutEffect(() => {
        const box = messagesBoxRef.current;

        if (prependAnchorRef.current !== null) {
            const { scrollHeight, scrollTop } = prependAnchorRef.current;
            prependAnchorRef.current = null;
            if (box) box.scrollTop = scrollTop + (box.scrollHeight - scrollHeight);
            return;
        }

        if (!messages.length) {
            lastMsgIdRef.current = null;
            return;
        }

        const lastId = messages[messages.length - 1]?._id;
        if (lastId !== lastMsgIdRef.current) {
            lastMsgIdRef.current = lastId;
            scrollToBottom();
        }
    }, [messages]);

    // Load more (older messages)
    const loadMore = () => {
        const nextPage = page + 1;
        api.post("/messages", { conversation_id: convId, page: nextPage })
        .then(({ data }) => {
            const box = messagesBoxRef.current;
            prependAnchorRef.current = {
                scrollHeight: box?.scrollHeight || 0,
                scrollTop: box?.scrollTop || 0
            };
            setMessages(prev => [...data.messages, ...prev]);
            setPage(nextPage);
            setHasMore(data.messages.length === 30);
        })
        .catch(() => {});
    };

    // Send message
    const handleSend = async () => {
        if (!newMessage.trim() || sending) return;

        setSending(true);
        const content = newMessage.trim();
        setNewMessage("");

        try {
            // For new conversations, send with recipient_id instead of conversation_id
            const payload = isNewConv
                ? { recipient_id: recipientId, content }
                : { conversation_id: convId, content };

            const { data } = await api.post("/message/send", payload);

            setMessages(prev => appendMessage(prev, data.message));
            scrollToBottom();

            // If this was a new conversation, notify parent with the real conversation ID
            if (isNewConv && data.conversation_id) {
                onConversationCreated?.(data.conversation_id);
            }

            onConversationUpdate?.();

            // Stop typing indicator
            const socket = getSocket();
            if (socket && convId) {
                socket.emit('stop_typing', {
                    conversation_id: convId,
                    recipient_id: other._id
                });
            }
        } catch (err) {
            toast.error(err.response?.data?.error || "Failed to send");
            setNewMessage(content); // Restore message
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Typing indicator
    const handleTyping = () => {
        const socket = getSocket();
        if (!socket || !other) return;

        socket.emit('typing', {
            conversation_id: convId,
            recipient_id: other._id
        });

        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            socket.emit('stop_typing', {
                conversation_id: convId,
                recipient_id: other._id
            });
        }, 2000);
    };

    // Accept / Decline message request
    const handleAcceptRequest = async () => {
        if (requestPending) return;
        setRequestPending(true);
        try {
            await api.post("/message-request/accept", { conversation_id: convId });
            toast.success("Request accepted");
            // Flip the ACTIVE conversation out of 'pending' too — onConversationUpdate only refreshes
            // the sidebar, which would strand us on a chat we accepted but still can't type in.
            onRequestAccepted?.(convId);
        } catch (err) {
            toast.error("Failed to accept request");
        } finally {
            setRequestPending(false);
        }
    };

    const handleDeclineRequest = async () => {
        if (requestPending) return;
        setRequestPending(true);
        try {
            await api.post("/message-request/decline", { conversation_id: convId });
            toast.success("Request declined");
            // The conversation is gone — close it rather than leaving a dead chat open.
            onRequestDeclined?.(convId);
        } catch (err) {
            toast.error("Failed to decline request");
        } finally {
            setRequestPending(false);
        }
    };

    // Empty state
    if (!conversation) {
        return (
            <div className="chat-empty">
                <Icon name="chat" className="chat-empty__icon" />
                <h3>Select a conversation</h3>
                <p>Choose a conversation from the sidebar or start a new one from a profile.</p>
            </div>
        );
    }

    return (
        <div className="chat-view">
            {/* Header */}
            <div className="chat-header">
                <Link to={`/user/${other?.personal_info?.username}`} className="chat-header__user">
                    <Avatar
                        src={other?.personal_info?.profile_img}
                        alt={other?.personal_info?.fullname}
                        size={36}
                    />
                    <div className="chat-header__info">
                        <span className="chat-header__name">{other?.personal_info?.fullname}</span>
                        <span className="chat-header__username">@{other?.personal_info?.username}</span>
                    </div>
                </Link>
                {isRequest && (
                    <span className="chat-header__request-tag">Message Request</span>
                )}
            </div>

            {/* Messages area */}
            <div className="chat-messages" ref={messagesBoxRef}>
                {hasMore && (
                    <button className="chat-load-more" onClick={loadMore}>
                        Load older messages
                    </button>
                )}

                {loading ? (
                    <div className="chat-loading">Loading messages...</div>
                ) : messages.length === 0 ? (
                    <div className="chat-start">
                        <Avatar
                            src={other?.personal_info?.profile_img}
                            alt=""
                            size={56}
                        />
                        <p>Start of your conversation with <strong>{other?.personal_info?.fullname}</strong></p>
                    </div>
                ) : (
                    messages.map((msg, i) => {
                        const isOwn = resolveSenderId(msg) === currentUserId;
                        // Show the avatar only on the first message of a same-sender run (group).
                        const showAvatar = i === 0 || resolveSenderId(messages[i-1]) !== resolveSenderId(msg);
                        return (
                            <MessageBubble
                                key={msg._id || i}
                                message={msg}
                                isOwn={isOwn}
                                showAvatar={showAvatar}
                                showReceipt={receiptFlags[i]}
                                myAvatar={myAvatar}
                                myName={myName}
                            />
                        );
                    })
                )}

                {isTyping && (
                    <div className="chat-typing">
                        <span className="chat-typing__dots">
                            <span></span><span></span><span></span>
                        </span>
                        <span>{other?.personal_info?.fullname} is typing...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Request Accept/Decline bar — only shown to recipient */}
            {isRequestRecipient && (
                <div className="chat-request-bar">
                    <p><strong>{other?.personal_info?.fullname}</strong> wants to message you</p>
                    <div className="chat-request-bar__actions">
                        <button className="chat-request-bar__accept" onClick={handleAcceptRequest} disabled={requestPending} style={requestPending ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
                            <Icon name="check" className="text-sm" /> Accept
                        </button>
                        <button className="chat-request-bar__decline" onClick={handleDeclineRequest} disabled={requestPending} style={requestPending ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
                            <Icon name="close" className="text-sm" /> Decline
                        </button>
                    </div>
                </div>
            )}

            {/* Sender waiting notice */}
            {isRequestSender && (
                <div className="chat-request-bar" style={{ justifyContent: 'center', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: 'rgb(var(--c-dark-grey))' }}>
                        <Icon name="schedule" className="text-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                        Waiting for <strong>{other?.personal_info?.fullname}</strong> to accept your request
                    </p>
                </div>
            )}

            {/* Input area — hidden if request is pending (for both sender and recipient) */}
            {(isNewConv || (!isRequest)) && (
                <div className="chat-input">
                    <textarea
                        ref={inputRef}
                        className="chat-input__field"
                        placeholder="Type a message..."
                        value={newMessage}
                        onChange={(e) => {
                            setNewMessage(e.target.value);
                            handleTyping();
                        }}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        maxLength={5000}
                    />
                    <button
                        className="chat-input__send"
                        onClick={handleSend}
                        disabled={!newMessage.trim() || sending}
                        aria-label="Send message"
                    >
                        <Icon name="send" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default ChatView;
