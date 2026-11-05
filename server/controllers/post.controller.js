import Post from '../Schema/Post.js';
import User from '../Schema/User.js';
import Notification from '../Schema/Notification.js';
import Like from '../Schema/Like.js';
import Comment from '../Schema/Comment.js';
import Publication from '../Schema/Publication.js';
import { escapeRegex } from '../utils/helpers.js';
import { deleteMultipleFromS3 } from '../config/s3.js';
import { emitNotification, emitBlogUpdate } from '../utils/notify.js';
import jwt from 'jsonwebtoken';
import { AUTH } from '../constants/auth.constants.js';

// Latest Posts (unified feed — returns both blogs and text posts)
export const latestPosts = (req, res) => {

    let { page, exclude_type } = req.body;

    let maxLimit = 5;

    let findQuery = { draft: false };
    if (exclude_type) findQuery.type = { $ne: exclude_type };

    Post.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname")
    .populate("publication", "title slug profile_photo")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner scroll_image activity tags readTime publishedAt publication type text_content images poll edited author")
    .limit(maxLimit)
    .skip((page - 1) * maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

};

// All latest posts count
export const allLatestPostsCount = (req, res) => {
    let { exclude_type } = req.body;
    let findQuery = { draft: false };
    if (exclude_type) findQuery.type = { $ne: exclude_type };

    Post.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.error('[Post] allLatestPostsCount failed:', err.message);
        return res.status(500).json({ error: err.message })
    })

};

// Trending posts
export const trendingPosts = (req, res) => {

    Post.find({ draft: false, type: { $ne: 'text_post' } })
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname")
    .populate("publication", "title slug profile_photo")
    .sort({ "activity.total_reads": -1, "activity.total_likes": -1, "publishedAt": -1 })
    .select("blog_id title des banner scroll_image activity tags readTime publishedAt publication type text_content images poll edited author")
    .limit(5)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

};

// Search posts
export const searchPosts = (req, res) => {

    let { tag, query, author, page, limit, eliminate_blog } = req.body;

    let findQuery;

    if(tag){
        findQuery = { tags: tag, draft: false, blog_id: { $ne: eliminate_blog } };
    }else if(query){
        findQuery = { draft: false, title: new RegExp(escapeRegex(query), 'i') }
    }else if(author){
        findQuery = { author, draft: false }
    }else{
        return res.status(400).json({ error: "Search query, tag, or author is required" });
    }

    let maxLimit = Math.min(Math.max(parseInt(limit) || 2, 1), 20); // Cap at 20, default 2

    Post.find(findQuery)
    .populate("author", "personal_info.profile_img personal_info.username personal_info.fullname")
    .populate("publication", "title slug profile_photo")
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner scroll_image activity tags readTime publishedAt publication type text_content images poll edited author")
    .skip((page - 1) * maxLimit)
    .limit(maxLimit)
    .then(blogs => {
        return res.status(200).json({ blogs })
    })
    .catch(err => {
        return res.status(500).json({ error: err.message })
    })

};

// Search posts count
export const searchPostsCount = (req, res) => {

    let { tag, author, query } = req.body;

    let findQuery;

    if(tag){
        findQuery = { tags: tag, draft: false };
    }else if(query){
        findQuery = { draft: false, title: new RegExp(escapeRegex(query), 'i') }
    }else if(author){
        findQuery = { author, draft: false }
    }else{
        return res.status(400).json({ error: "Search query, tag, or author is required" });
    }

    Post.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count })
    })
    .catch(err => {
        console.error('[Post] searchPostsCount failed:', err.message);
        return res.status(500).json({ error: err.message })
    })

};

// Get single post (works for both blogs and text posts)
export const getPost = (req, res) => {
    let { blog_id, draft, mode } = req.body;

    Post.findOne({ blog_id })
        .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img personal_info.bio account_info.total_posts account_info.total_reads")
        .populate("publication", "title slug description total_subscribers total_posts profile_photo")
        .select("title des content banner scroll_image activity publishedAt updatedAt blog_id tags draft author publication type text_content images poll")
        .then(blog => {
            if (!blog) {
                return res.status(404).json({ error: "Blog not found" });
            }

            // Secure draft access
            if (blog.draft) {
                if (!draft) {
                    return res.status(403).json({ error: "You cannot access draft blogs" });
                }
                // Verify ownership using JWT
                const authHeader = req.headers['authorization'];
                const token = authHeader && authHeader.split(" ")[1];
                if (!token) return res.status(401).json({ error: "Access denied to draft" });
                
                try {
                    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { clockTolerance: AUTH.CLOCK_TOLERANCE_S });
                    if (decoded.id !== blog.author._id.toString()) {
                        return res.status(403).json({ error: "You can only access your own drafts" });
                    }
                } catch (err) {
                    return res.status(401).json({ error: "Invalid access token" });
                }
            }
            // Read tracking is handled by the dedicated /record-read endpoint
            // which validates scroll depth, time spent, and deduplicates per user.

            return res.status(200).json({ blog });
        })
        .catch(err => {
            return res.status(500).json({ error: err.message });
        });
};

// A published post's engagement numbers and nothing else. Signed-in readers poll this once a minute
// while the post is open, so the counts stay current without holding a socket open.
export const getPostActivity = async (req, res) => {
    const post = await Post.findOne({ blog_id: { $eq: req.body.blog_id }, draft: false })
        .select("activity.total_likes activity.total_comments poll")
        .lean();

    if (!post) {
        return res.status(404).json({ error: "Blog not found" });
    }

    return res.status(200).json({ activity: post.activity, poll: post.poll });
};

// Like post — idempotent: the count and notification only change when the like state actually flips,
// so a stale/duplicate request can't inflate total_likes (which is now broadcast live to all viewers).
export const likePost = async (req, res) => {

    const user_id = req.user;
    const { _id, isLikedByUser } = req.body;

    if (!_id) {
        return res.status(400).json({ error: "Blog ID is required" });
    }

    // `isLikedByUser` is what the CLIENT believes the current state is, and it is not trustworthy:
    // its status query may not have resolved yet, may be stale (10 min staleTime), or a second
    // rapid click may carry the flipped optimistic value. This handler is therefore idempotent —
    // it reconciles against the DB rather than blindly toggling — and EVERY response carries the
    // authoritative `total_likes` so the client can replace its optimistic guess with the truth.
    // Without that, a no-op branch left the client showing a +1 the server never applied, which
    // survived on screen (feeds settle with refetchType:'none') until a refresh "reverted" it.
    const currentLikes = async () => {
        const doc = await Post.findById(_id).select("activity.total_likes");
        return doc?.activity?.total_likes ?? 0;
    };

    try {
        if (!isLikedByUser) {
            // LIKE. The upsert is the idempotency guarantee: the unique (user, blog) index means
            // only ONE of any number of concurrent/duplicate likes can insert, so the count can
            // never be double-incremented by a double-tap or a retry.
            const result = await Like.updateOne(
                { user: user_id, blog: _id },
                { $setOnInsert: { user: user_id, blog: _id } },
                { upsert: true },
            );
            const isNewLike = (result.upsertedCount ?? 0) > 0;

            if (!isNewLike) {
                // Already liked — our caller's flag was stale. Report the truth, change nothing.
                return res.status(200).json({ liked_by_user: true, total_likes: await currentLikes() });
            }

            const blog = await Post.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes": 1 } }, { new: true });
            if (!blog) {
                // Post vanished between the like and the increment — don't strand the row.
                await Like.deleteOne({ user: user_id, blog: _id });
                return res.status(404).json({ error: "Blog not found" });
            }

            // The notification is now only an inbox item for the author. Deleting it no longer
            // destroys the like, so a self-like simply gets no notification at all.
            if (String(blog.author) !== String(user_id)) {
                await new Notification({ type: "like", blog: _id, notification_for: blog.author, user: user_id }).save();
                emitNotification(req, blog.author, { type: "like" });
            }

            emitBlogUpdate(req, blog._id, { total_likes: blog.activity.total_likes });

            return res.status(200).json({ liked_by_user: true, total_likes: blog.activity.total_likes });
        } else {
            // UNLIKE — only decrement if a like actually existed (deletedCount is the source of
            // truth, so a repeated unlike can't drive the count negative).
            const removal = await Like.deleteOne({ user: user_id, blog: _id });
            if ((removal.deletedCount ?? 0) === 0) {
                return res.status(200).json({ liked_by_user: false, total_likes: await currentLikes() });
            }

            const blog = await Post.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes": -1 } }, { new: true });
            if (blog) {
                emitBlogUpdate(req, blog._id, { total_likes: blog.activity.total_likes });
            }

            // Retract the author's inbox item too, and tell them so their Activity dot can CLEAR
            // (only the like path used to emit, so a revoked like left the dot stuck until the
            // 60s poll).
            const removedNotification = await Notification.findOneAndDelete({ user: user_id, blog: _id, type: "like" });
            if (removedNotification && String(removedNotification.notification_for) !== String(user_id)) {
                emitNotification(req, removedNotification.notification_for, { type: "like_removed" });
            }

            return res.status(200).json({
                liked_by_user: false,
                total_likes: blog ? blog.activity.total_likes : await currentLikes(),
            });
        }
    } catch (err) {
        console.error('[Post] likePost failed:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// Is liked by user
export const isLikedByUser = (req, res) => {

    let user_id = req.user;

    let { _id } = req.body;

    // Reads the LIKE, not the author's notification — the two are separate records now.
    Like.exists({ user: user_id, blog: _id })
    .then(found => {
        // Mongoose `exists` resolves to a doc stub or null; send a real boolean so callers can't
        // be fooled by a truthy object.
        return res.status(200).json({ result: !!found });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })

};

// User written posts
export const userWrittenPosts = (req, res) => {

    let user_id = req.user;

    let { page, draft, query, deletedDocCount, sort } = req.body;

    let maxLimit = 5;
    let skipDocs = (page - 1) * maxLimit;

    if(deletedDocCount){
        skipDocs -= deletedDocCount;
    }

    // Map sort parameter to MongoDB sort object
    let sortQuery;
    switch (sort) {
        case 'oldest':
            sortQuery = { publishedAt: 1 };
            break;
        case 'most_liked':
            sortQuery = { 'activity.total_likes': -1 };
            break;
        case 'most_read':
            sortQuery = { 'activity.total_reads': -1 };
            break;
        case 'newest':
        default:
            sortQuery = { publishedAt: -1 };
            break;
    }

    // For text posts, also match against text_content
    let findQuery = { author: user_id, draft };
    if (req.body.content_type) {
        findQuery.type = req.body.content_type;
    }
    if (query) {
        const regex = new RegExp(escapeRegex(query), 'i');
        findQuery.$or = [{ title: regex }, { text_content: regex }];
    }

    // `content` is the full article body (up to a couple of MB for long-form posts). List/card
    // consumers (manage-blogs grid, text-post drafts) never render it, so we omit it by default —
    // otherwise every page would ship several unused MB. Only the blog editor's draft picker needs it
    // (to reload a draft for editing) and opts in via include_content.
    // The "add existing articles to a publication" picker opts into `with_publication`: it needs the
    // Mongo `_id` (add/remove-blog key off it) AND each post's current publication (populated) so it
    // can show/toggle membership. Every other caller keeps the lean, _id-less default payload.
    const withPublication = req.body?.with_publication;
    let listFields = " title banner publishedAt blog_id activity des draft type text_content images poll tags ";
    listFields += withPublication ? " publication " : " -_id ";
    const fields = req.body?.include_content ? listFields + " content" : listFields;

    let queryBuilder = Post.find(findQuery)
        .skip(skipDocs)
        .limit(maxLimit)
        .sort(sortQuery)
        .select(fields);

    if (withPublication) {
        queryBuilder = queryBuilder.populate('publication', 'title slug');
    }

    queryBuilder
    .then(blogs => {
        return res.status(200).json({ blogs });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })

};

// User written posts count
export const userWrittenPostsCount = (req, res) => {

    let user_id = req.user;
    let { draft, query } = req.body;
    // For text posts, also match against text_content
    let findQuery = { author: user_id, draft };
    if (req.body.content_type) {
        findQuery.type = req.body.content_type;
    }
    if (query) {
        const regex = new RegExp(escapeRegex(query), 'i');
        findQuery.$or = [{ title: regex }, { text_content: regex }];
    }

    Post.countDocuments(findQuery)
    .then(count => {
        return res.status(200).json({ totalDocs: count });
    })
    .catch(err => {
        console.error('[Post] userWrittenPostsCount failed:', err.message);
        return res.status(500).json({ error: err.message });
    })

};

// Delete post (soft delete — marks with deletedAt timestamp)
export const deletePost = (req, res) => {

    let user_id = req.user;
    let { blog_id } = req.body;

    Post.findOneAndUpdate(
        { blog_id, author: user_id },
        { deletedAt: new Date() },
        { new: true }
    )
    .then(async blog => {

        if(!blog) {
            return res.status(403).json({ error: "You do not have permission to delete this blog" });
        }

        // Deleting a counted post (published article in a publication) must release its
        // total_posts slot: feeds/counts exclude deleted posts immediately (soft-delete
        // pre-hooks), but the counter was never decremented — so the publication overcounted
        // forever, and the route's 'publications' cache flush just re-cached the wrong number.
        // Awaited so the flush (fires on res.json) sees the committed decrement. Double-delete
        // safe: the soft-delete filter on findOneAndUpdate means a re-delete never reaches here.
        if (blog.publication && !blog.draft && blog.type !== 'text_post') {
            await Publication.findByIdAndUpdate(blog.publication, { $inc: { total_posts: -1 } })
                .catch(err => req.log?.error({ err }, 'publication count update error'));
        }

        // Collect all S3 image URLs from the post
        const imageUrls = [];

        // 1. Banner image (blog-type)
        if (blog.banner && blog.banner.includes('amazonaws.com')) {
            imageUrls.push(blog.banner);
        }

        // 2. Extract image URLs from content for S3 cleanup (blog-type)
        if (blog.content) {
            const rawContent = Array.isArray(blog.content) ? blog.content[0] : blog.content;
            
            if (rawContent?.type === 'doc' && rawContent.content) {
                // Tiptap format — recursively find image nodes
                const findTiptapImages = (nodes) => {
                    if (!Array.isArray(nodes)) return;
                    for (const node of nodes) {
                        if (node.type === 'image' && node.attrs?.src) {
                            if (node.attrs.src.includes('amazonaws.com')) {
                                imageUrls.push(node.attrs.src);
                            }
                        }
                        if (node.type === 'fileAttachment' && node.attrs?.url) {
                            if (node.attrs.url.includes('amazonaws.com')) {
                                imageUrls.push(node.attrs.url);
                            }
                        }
                        if (node.content) findTiptapImages(node.content);
                    }
                };
                findTiptapImages(rawContent.content);
            } else {
                // Legacy EditorJS format
                const blocks = rawContent?.blocks || [];
                blocks.forEach(block => {
                    if (block.type === 'image' && block.data?.file?.url) {
                        if (block.data.file.url.includes('amazonaws.com')) {
                            imageUrls.push(block.data.file.url);
                        }
                    }
                });
            }
        }
        // 3. Text post images
        if (blog.images && blog.images.length > 0) {
            blog.images.forEach(url => {
                if (url && url.includes('amazonaws.com')) {
                    imageUrls.push(url);
                }
            });
        }

        // 4. Fire-and-forget S3 cleanup (non-blocking)
        if (imageUrls.length > 0) {
            deleteMultipleFromS3(imageUrls)
                .catch(err => req.log?.error({ err }, 'S3 cleanup failed'));
        }

        Notification.deleteMany({ blog: blog._id })
            .catch(err => req.log?.error({ err }, 'notification delete error'));

        // Likes are their own records now, so they need their own cascade.
        Like.deleteMany({ blog: blog._id })
            .catch(err => req.log?.error({ err }, 'like delete error'));

        Comment.deleteMany({ blog_id: blog._id })
            .catch(err => req.log?.error({ err }, 'comments delete error'));

        let updateQuery = { $pull: { blogs: blog._id } };
        if (blog.type !== 'text_post') {
            updateQuery.$inc = { "account_info.total_posts": -1 };
        }

        User.findOneAndUpdate({ _id: user_id }, updateQuery)
            .catch(err => req.log?.error({ err }, 'user update error'));

        return res.status(200).json({ status: "done" });

    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })

};

// Batch check liked status for multiple posts
export const batchIsLiked = (req, res) => {
    let user_id = req.user;
    let { blog_ids } = req.body;

    if (!blog_ids || !Array.isArray(blog_ids) || blog_ids.length === 0) {
        return res.status(200).json({ likedBlogs: [] });
    }

    Like.find({ user: user_id, blog: { $in: blog_ids } })
    .select("blog")
    .then(likes => {
        let likedBlogs = likes.map(l => l.blog.toString());
        return res.status(200).json({ likedBlogs });
    })
    .catch(err => {
        return res.status(500).json({ error: err.message });
    })
};
