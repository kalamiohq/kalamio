import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import Logo, { KALAMIO_ORANGE } from "../components/Logo";

// "404." set in the wordmark's face (DM Sans SemiBold), ending in the logo's orange full stop.
// The digits take currentColor so the art follows the theme; outlines come from /brand.
const DIGITS = "M186.76 144Q167.67 144 153.85 134.95Q140.02 125.9 132.66 109.69Q125.3 93.48 125.3 72Q125.3 50.52 132.66 34.31Q140.02 18.1 153.75 9.05Q167.47 0 186.76 0Q205.86 0 219.48 9.05Q233.1 18.1 240.46 34.31Q247.82 50.52 247.82 72Q247.82 93.48 240.46 109.69Q233.1 125.9 219.48 134.95Q205.86 144 186.76 144ZM69.02 141.61V115.16H0V96.07L60.27 2.39H92.88V94.28H111.78V115.16H92.88V141.61ZM331.36 141.61V115.16H262.34V96.07L322.61 2.39H355.23V94.28H374.12V115.16H355.23V141.61ZM186.56 122.52Q197.5 122.52 205.86 116.45Q214.21 110.39 218.88 99.05Q223.56 87.71 223.56 72Q223.56 56.29 218.88 44.95Q214.21 33.61 205.86 27.55Q197.5 21.48 186.56 21.48Q175.82 21.48 167.47 27.55Q159.12 33.61 154.44 44.95Q149.77 56.29 149.77 72Q149.77 87.71 154.44 99.05Q159.12 110.39 167.47 116.45Q175.82 122.52 186.56 122.52ZM25.66 94.28H70.61V23.07H70.21ZM288 94.28H332.95V23.07H332.55Z";
const FULL_STOP = { cx: 402.17, cy: 124.71, r: 17.9 };

const PageNotFound = () => {

    return(
        <section className="h-cover relative p-10 flex flex-col items-center gap-12 text-center">

            <svg viewBox="0 0 420.07 144" className="w-64 md:w-72 h-auto text-black select-none" role="img" aria-label="404">
                <path fill="currentColor" d={DIGITS} />
                <circle cx={FULL_STOP.cx} cy={FULL_STOP.cy} r={FULL_STOP.r} fill={KALAMIO_ORANGE} />
            </svg>

            <div>
                <h1 className="text-4xl font-bold font-display mb-4">Page not found</h1>
                <p className="text-dark-grey text-xl leading-7 max-w-md mx-auto">
                    The page you're looking for doesn't exist. Head back to the <Link to="/" className="text-black font-semibold hover:underline">home page</Link>
                </p>
            </div>

            <Link to="/" className="btn-brand py-3 px-8 flex items-center gap-2">
                <Icon name="home" className="text-xl" />
                Back to Home
            </Link>

            <div className="mt-auto">
                <Logo className="h-8 mx-auto text-black" />
                <p className="mt-5 text-dark-grey text-sm">Read millions of stories around the world</p>
            </div>

        </section>
    )
}

export default PageNotFound;
