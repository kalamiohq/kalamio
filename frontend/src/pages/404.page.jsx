import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import Logo, { KALAMIO_ORANGE, KALAMIO_WHITE } from "../components/Logo";

// "404" set in the wordmark's face (DM Sans SemiBold), with the K-mark standing in for the 0.
// The digits take currentColor so the art follows the theme; outlines come from /brand.
const DIGITS = "M76 0L76 -26.6L6.6 -26.6L6.6 -45.8L67.2 -140L99.8 -140L99.8 -47.6L118.8 -47.6L118.8 -26.6L99.8 -26.6L99.8 0ZM32.4 -47.6L77.4 -47.6L77.4 -119.2L77 -119.2ZM375.49 0L375.49 -26.6L306.09 -26.6L306.09 -45.8L366.69 -140L399.29 -140L399.29 -47.6L418.29 -47.6L418.29 -26.6L399.29 -26.6L399.29 0ZM331.89 -47.6L376.89 -47.6L376.89 -119.2L376.49 -119.2Z";
const K = "M184.3 -136.88A72.4 72.4 0 0 1 202.4 -141.76L202.4 -93.89L240.72 -136.47A72.4 72.4 0 0 1 254.9 -128.34L202.4 -70L254.9 -11.66A72.4 72.4 0 0 1 240.72 -3.53L202.4 -46.11L202.4 1.76A72.4 72.4 0 0 1 184.3 -3.12Z";

const PageNotFound = () => {

    return(
        <section className="h-cover relative p-10 flex flex-col items-center gap-12 text-center">

            <svg viewBox="6.6 -142.4 411.69 144.8" className="w-64 md:w-72 h-auto text-black select-none" role="img" aria-label="404">
                <path fill="currentColor" d={DIGITS} />
                <circle cx="212.02" cy="-70" r="72.4" fill={KALAMIO_ORANGE} />
                <path fill={KALAMIO_WHITE} d={K} />
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
