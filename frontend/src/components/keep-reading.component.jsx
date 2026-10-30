import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { cdnUrl } from "../common/cdn";

const STORAGE_KEY = "kalamio_keep_reading";
const LEGACY_STORAGE_KEY = "notelys_keep_reading";

// Call this from blog.page.jsx to save reading progress
export const saveReadingProgress = (blog) => {
    if (!blog || !blog.blog_id) return;

    const data = {
        blog_id: blog.blog_id,
        title: blog.title || "",
        text_content: blog.text_content || "",
        type: blog.type || "blog",
        banner: blog.banner || "",
        author: blog.author?.personal_info?.fullname || "",
        savedAt: Date.now(),
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // localStorage full or unavailable
    }
};

const KeepReading = () => {
    const [article, setArticle] = useState(null);

    useEffect(() => {
        try {
            let saved = localStorage.getItem(STORAGE_KEY);

            if (saved === null) {
                const legacySaved = localStorage.getItem(LEGACY_STORAGE_KEY);
                if (legacySaved !== null) {
                    saved = legacySaved;
                    try {
                        localStorage.setItem(STORAGE_KEY, legacySaved);
                        localStorage.removeItem(LEGACY_STORAGE_KEY);
                    } catch (e) {
                        // Keep displaying the legacy value if storage cannot complete the migration.
                    }
                }
            }

            if (saved) {
                const data = JSON.parse(saved);
                // Only show if saved within last 7 days
                const sevenDays = 7 * 24 * 60 * 60 * 1000;
                if (Date.now() - data.savedAt < sevenDays) {
                    setArticle(data);
                }
            }
        } catch (e) {
            // ignore
        }
    }, []);

    if (!article) return null;

    return (
        <div className="keep-reading">
            <div className="flex items-center justify-between mb-3">
                <p className="keep-reading__label !mb-0" style={{ marginBottom: 0 }}>
                    <Icon name="auto_stories" className="text-base" />
                    Keep reading
                </p>
                <div className="relative group cursor-pointer text-dark-grey hover:text-black transition-colors flex items-center">
                    <Icon name="info" className="text-[14px]" />
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 w-[180px] p-2.5 bg-black !text-white text-[12px] font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg leading-relaxed text-center">
                        Here you will find the post or article where you left off reading.
                    </div>
                </div>
            </div>
            <Link to={`/blog/${article.blog_id}`} className="keep-reading__card">
                {article.type === 'text_post' ? (
                    <div className="keep-reading__info w-full" style={{ padding: '4px 0' }}>
                        <span className="keep-reading__meta" style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="format_quote" className="text-[14px]" />
                            {article.author}
                        </span>
                        <span className="keep-reading__title" style={{ WebkitLineClamp: 3, fontSize: '13px', lineHeight: '1.4' }}>
                            {article.text_content || "Text post"}
                        </span>
                    </div>
                ) : (
                    <>
                        {article.banner && (
                            <div className="keep-reading__thumb">
                                <img src={cdnUrl(article.banner)} alt={article.title} />
                            </div>
                        )}
                        <div className="keep-reading__info">
                            <span className="keep-reading__title">{article.title || "Untitled"}</span>
                            <span className="keep-reading__meta">{article.author}</span>
                        </div>
                    </>
                )}
            </Link>
        </div>
    );
};

export default KeepReading;
