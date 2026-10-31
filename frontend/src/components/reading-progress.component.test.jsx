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

const ticksOf = (indicator) => Array.from(indicator.querySelectorAll("span"));
const activeTick = (indicator) =>
    ticksOf(indicator).findIndex((tick) => tick.getAttribute("data-active") === "true");
const currentProgress = (indicator = screen.getByRole("progressbar")) =>
    Number(indicator.getAttribute("aria-valuenow"));

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

    it("renders a vertical column of ticks at 0% at the top of a long article", () => {
        render(<Harness />);
        const indicator = screen.getByRole("progressbar");

        expect(indicator).toHaveAttribute("role", "progressbar");
        expect(indicator).toHaveAttribute("aria-valuemin", "0");
        expect(indicator).toHaveAttribute("aria-valuemax", "100");
        expect(indicator).not.toHaveAttribute("hidden");
        expect(indicator.style.display).not.toBe("none");
        expect(currentProgress(indicator)).toBe(0);
        expect(ticksOf(indicator)).toHaveLength(15);
        expect(activeTick(indicator)).toBe(0);
        expect(ticksOf(indicator)[0]).toHaveClass("bg-black");
    });

    it("moves the dark tick down the column as the reader scrolls", () => {
        render(<Harness />);

        rect.top = -1600; // half of the 3200px scrollable distance
        fireEvent.scroll(window);
        flushRaf();

        const indicator = screen.getByRole("progressbar");
        expect(currentProgress(indicator)).toBe(50);
        expect(activeTick(indicator)).toBe(7);
        expect(ticksOf(indicator).filter((tick) => tick.getAttribute("data-active") === "true")).toHaveLength(1);
    });

    it("reaches 100% at the end and stays clamped between 0 and 100", () => {
        render(<Harness />);
        const indicator = screen.getByRole("progressbar");

        rect.top = -3200; // article bottom aligns with viewport bottom
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress(indicator)).toBe(100);
        expect(activeTick(indicator)).toBe(14);

        rect.top = -9999;
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress(indicator)).toBe(100);
        expect(activeTick(indicator)).toBe(14);

        rect.top = 200; // article starts below the viewport top
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress(indicator)).toBe(0);
        expect(activeTick(indicator)).toBe(0);
    });

    it("hides the indicator when the whole article fits on screen", () => {
        rect = { top: 100, height: 300 };
        render(<Harness />);
        const indicator = screen.getByRole("progressbar", { hidden: true });
        expect(indicator.style.display).toBe("none");
        expect(indicator).not.toBeVisible();

        // It comes back once the article is taller than the viewport.
        rect = { top: -800, height: 4000 };
        fireEvent.scroll(window);
        flushRaf();
        expect(indicator.style.display).toBe("");
        expect(indicator).toBeVisible();
        expect(currentProgress(indicator)).toBe(25);
    });

    it("recalculates when the viewport is resized", () => {
        render(<Harness />);
        const indicator = screen.getByRole("progressbar");

        rect.top = -800; // 25% at 800px viewport height
        fireEvent.scroll(window);
        flushRaf();
        expect(currentProgress(indicator)).toBe(25);

        Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
        fireEvent(window, new Event("resize"));
        flushRaf();
        expect(currentProgress(indicator)).toBe(22);
    });

    it("removes scroll and resize listeners on unmount", () => {
        const removeSpy = vi.spyOn(window, "removeEventListener");
        const { unmount } = render(<Harness />);

        unmount();

        expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    });
});
