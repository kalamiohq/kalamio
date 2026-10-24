import TiptapRenderer from './editor/utils/tiptap-renderer';
import { cdnUrl } from '../common/cdn';

// ── Format Detection ──
const isTiptapContent = (content) => {
    if (!content) return false;
    if (Array.isArray(content)) {
        return content[0]?.type === 'doc';
    }
    return content?.type === 'doc';
};

// ── Legacy EditorJS Rendering (preserved for backward compat) ──

// function to handle spaces in quotes.
const cleanHTML = (html = "") => {
    return html.replace(/&nbsp;/g, " ").trim();
};

const Img = ({ url, caption }) => {
    return (
        <div>
            {/* cdnUrl: legacy posts are the bulk of existing content — without this their images
                bypass the edge cache and hit the S3 Mumbai origin directly. */}
            <img src={cdnUrl(url)} alt={caption || "Blog image"} loading="lazy" decoding="async" />
            {
                caption.length ? <p className="w-full text-center my-3 md:mb-12 text-base text-dark-grey">{cleanHTML(caption)}</p> : ""
            }
        </div>
    )
}

const Quote = ({ quote, caption }) => {
    return (
        <div className="bg-kalamio/10 p-3 pl-5 border-l-4 border-kalamio rounded-r-lg">
            <p className="text-xl leading-10 md:text-2xl">{cleanHTML(quote)}</p>
            {
                caption.length ? <p className="w-full text-dark-grey text-base mt-2">{cleanHTML(caption)}</p> : ""
            }
        </div>
    )
}

const List = ({ style, items }) => {
    return (
        <ol className={`pl-5 ${ style == "ordered" ? "list-decimal" : "list-disc"}`}>

            {
                items.map((listItems, i) => {
                    return <li key={i} className="my-4" dangerouslySetInnerHTML={{ __html: cleanHTML(listItems) }}></li>
                })
            }

        </ol>
    )
}

const EditorJSBlock = ({ block }) => {

    let { type, data } = block;

    if(type == "paragraph"){
        return <p dangerouslySetInnerHTML={{ __html: cleanHTML(data.text) }}></p>
    }

    if(type == "header"){
        if(data.level == 3){
            return <h3 className="text-3xl font-bold" dangerouslySetInnerHTML={{ __html: cleanHTML(data.text) }}></h3>
        }
        return <h2 className="text-4xl font-bold" dangerouslySetInnerHTML={{ __html: cleanHTML(data.text) }}></h2>
    }

    if(type == "image"){
        return <Img url={data.file.url} caption={data.caption} />
    }

    if(type == "quote"){
        return <Quote quote={data.text} caption={data.caption} />
    }
    
    if(type == "list"){
        return <List style={data.style} items={data.items} />
    }

}

// ── Main Component (auto-detects format) ──
const BlogContent = ({ content }) => {
    const normalizedContent = Array.isArray(content) ? content[0] : content;

    if (isTiptapContent(content)) {
        return <TiptapRenderer content={normalizedContent} />;
    }

    // Legacy EditorJS rendering
    const blocks = normalizedContent?.blocks || [];
    return (
        <>
            {blocks.map((block, i) => (
                <div key={i} className="my-4 md:my-8">
                    <EditorJSBlock block={block} />
                </div>
            ))}
        </>
    );
};

export default BlogContent;