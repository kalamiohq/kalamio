import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRef } from "react";
import ReadingProgress from "./reading-progress.component";

const Harness = () => {
    const articleRef = useRef(null);
    return (
        <>
            <div data-testid="article" ref={articleRef} />
            <ReadingProgress targetRef={articleRef} resetKey="blog-1" />
        </>
    );
};

const fillOf = (bar) => bar.firstElementChild;
const currentProgress = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

describe("ReadingProgress", () => {
    let rect;
    let rafQueue;

    const flushRaf = () => {
        const queued = rafQueue;
        rafQueue = [];
        queued.forEach((cb) => cb(0));
    };

    beforeEach(() => {
        rect = { top: 0, height: 4000 };
        rafQueue = [];
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
            top: rect.top,
            height: rect.height,
            bottom: rect.top + rect.height,
            left: 0,
            right: 0,
            width: 0,
            x: 0,
            y: 0,
            toJSON: () => {},
        }));
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
        vi.stubGlobal("requestAnimationFrame", (cb) => { rafQueue.push(cb); return rafQueue.length; });
        vi.stubGlobal("cancelAnimationFrame", () => {});
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("starts at 0% at the top of a long article", () => {
        render(<Harness />);
        const bar = screen.getByRole("progressbar");

        expect(bar).toHaveAttribute("role", "progressbar");
        expect(bar).toHaveAttribute("aria-valuemin", "0");
        expect(bar).toHaveAttribute("aria-valuemax", "100");
        expect(currentProgress()).toBe(0);
        expect(fillOf(bar).style.transform).toBe("scaleX(0)");
    });

    it("advances with scroll through the article", () => {
        render(<Harness />);

        rect.top = -1600; // half of the 3200px scrollable distance
        fireEvent.scroll(window);
        flushRaf();

        expect(currentProgress()).toBe(50);
        expect(fillOf(screen.getByRole("progressbar")).style.transform).toBe("scaleX(0.5)");
    });

    it("reaches 100% at the end and stays clamped between 0 and 100", () => {
        render(<Harness />);

        rect.top = -3200; // article bottom aligns with viewport bottom
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress()).toBe(100);

        rect.top = -9999;
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress()).toBe(100);

        rect.top = 200; // article starts below the viewport top
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress()).toBe(0);
    });

    it("handles short articles that fit entirely in the viewport", () => {
        rect = { top: 100, height: 300 };
        render(<Harness />);
        expect(currentProgress()).toBe(100); // fully visible, so fully read

        rect = { top: 900, height: 300 };
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress()).toBe(0); // entirely below the fold
    });

    it("recalculates when the viewport is resized", () => {
        render(<Harness />);

        rect.top = -800; // 25% at 800px viewport height
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress()).toBe(25);

        Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
        fireEvent(window, new Event("resize"));
        flushRaf();
        expect(currentProgress()).toBe(22);
    });

    it("removes scroll and resize listeners on unmount", () => {
        const removeSpy = vi.spyOn(window, "removeEventListener");
        const { unmount } = render(<Harness />);

        unmount();

        expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    });
});
