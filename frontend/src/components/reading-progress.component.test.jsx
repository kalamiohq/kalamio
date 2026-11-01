import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
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

const SectionHarness = ({ headings = ["Intro", "Setup", "Usage"], levels = [] }) => {
    const articleRef = useRef(null);
    const contentRef = useRef(null);
    return (
        <>
            <div data-testid="article" ref={articleRef}>
                <h1>Article title</h1>
                <div ref={contentRef}>
                    {headings.map((text, index) => {
                        const Tag = `h${levels[index] || 2}`;
                        return <Tag key={text}>{text}</Tag>;
                    })}
                </div>
            </div>
            <ReadingProgress
                targetRef={articleRef}
                contentRef={contentRef}
                resetKey="blog-1"
                content={headings}
            />
        </>
    );
};

const ticksOf = (indicator) => Array.from(indicator.querySelectorAll("span"));
const activeTick = (indicator) =>
    ticksOf(indicator).findIndex((tick) => tick.getAttribute("data-active") === "true");
const currentProgress = (indicator = screen.getByRole("progressbar")) =>
    Number(indicator.getAttribute("aria-valuenow"));

const tickBar = (button) => button.querySelector("span:last-child");
const navIndicator = () =>
    screen.getByRole("navigation", { name: "Article sections" });

const setHeadingTop = (heading, top) => {
    heading.getBoundingClientRect = vi.fn(() => ({
        top,
        height: 40,
        bottom: top + 40,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => {},
    }));
};

describe("ReadingProgress", () => {
    let rect;
    let rafQueue;

    const flushRaf = () => {
        const queued = rafQueue;
        rafQueue = [];
        act(() => {
            queued.forEach((cb) => cb(0));
        });
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

    it("uses one tick per article heading and ignores the title", () => {
        render(<SectionHarness levels={[1, 2, 3]} />);

        expect(navIndicator()).toBeInTheDocument();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

        ["Intro", "Setup", "Usage"].forEach((heading) => {
            expect(screen.getByRole("button", { name: heading })).toBeInTheDocument();
        });
        expect(
            screen.queryByRole("button", { name: "Article title" })
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /contents/i })).toBeInTheDocument();
    });

    it("re-discovers sections when the article content arrives later", () => {
        const { rerender } = render(<SectionHarness headings={[]} />);
        expect(screen.getByRole("progressbar")).toBeInTheDocument();

        rerender(<SectionHarness headings={["Intro", "Setup"]} />);

        expect(navIndicator()).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Setup" })).toBeInTheDocument();
    });

    it("moves the active tick as the reader scrolls through sections", () => {
        render(<SectionHarness />);

        const intro = screen.getByRole("heading", { name: "Intro" });
        const setup = screen.getByRole("heading", { name: "Setup" });
        const usage = screen.getByRole("heading", { name: "Usage" });

        const scrollToTops = (tops) => {
            [intro, setup, usage].forEach((heading, index) =>
                setHeadingTop(heading, tops[index])
            );
            fireEvent.scroll(window);
            flushRaf();
        };

        scrollToTops([600, 1000, 1400]);
        expect(screen.getByRole("button", { name: "Intro" })).toHaveAttribute(
            "aria-current",
            "location"
        );
        expect(tickBar(screen.getByRole("button", { name: "Intro" }))).toHaveClass(
            "bg-black",
            "w-6"
        );
        expect(tickBar(screen.getByRole("button", { name: "Setup" }))).toHaveClass(
            "bg-border",
            "w-4"
        );

        scrollToTops([-200, -100, 300]);
        expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute(
            "aria-current",
            "location"
        );
        expect(tickBar(screen.getByRole("button", { name: "Intro" }))).toHaveClass(
            "bg-border",
            "w-4"
        );

        scrollToTops([-200, -100, -50]);
        expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute(
            "aria-current",
            "location"
        );
    });

    it("scrolls to the heading when its tick is clicked", () => {
        render(<SectionHarness />);

        const setup = screen.getByRole("heading", { name: "Setup" });
        const scrollSpy = vi.fn();
        setup.scrollIntoView = scrollSpy;

        fireEvent.click(screen.getByRole("button", { name: "Setup" }));

        expect(scrollSpy).toHaveBeenCalledWith({
            behavior: "smooth",
            block: "start",
        });
        // Leaves the sticky navbar's 80px in view.
        expect(setup.style.scrollMarginTop).toBe("80px");
    });

    it("keeps the evenly spaced ticks when there are fewer than two headings", () => {
        render(<SectionHarness headings={["Intro"]} />);

        const indicator = screen.getByRole("progressbar");
        expect(ticksOf(indicator)).toHaveLength(15);
        expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: /contents/i })
        ).not.toBeInTheDocument();
    });

    it("opens the phone Contents sheet, scrolls to a heading and closes it", () => {
        render(<SectionHarness />);

        const contentsButton = screen.getByRole("button", { name: /contents/i });
        expect(contentsButton).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(contentsButton);
        const dialog = screen.getByRole("dialog", { name: "Contents" });
        expect(contentsButton).toHaveAttribute("aria-expanded", "true");

        const setup = screen.getByRole("heading", { name: "Setup" });
        const scrollSpy = vi.fn();
        setup.scrollIntoView = scrollSpy;

        fireEvent.click(within(dialog).getByRole("button", { name: "Setup" }));

        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("moves focus into the sheet and restores it to the Contents button", () => {
        render(<SectionHarness />);

        const contentsButton = screen.getByRole("button", { name: /contents/i });
        fireEvent.click(contentsButton);

        const closeButton = screen.getByRole("button", { name: "Close contents" });
        expect(closeButton).toHaveFocus();

        fireEvent.click(closeButton);
        expect(contentsButton).toHaveFocus();
    });

    it("keeps Tab focus inside the phone sheet", () => {
        render(<SectionHarness />);

        fireEvent.click(screen.getByRole("button", { name: /contents/i }));

        const closeButton = screen.getByRole("button", { name: "Close contents" });
        const lastHeading = within(screen.getByRole("dialog")).getByRole("button", {
            name: "Usage",
        });

        lastHeading.focus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(closeButton).toHaveFocus();

        closeButton.focus();
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(lastHeading).toHaveFocus();
    });

    it("closes the phone sheet with its button, the backdrop and Escape", () => {
        render(<SectionHarness />);

        const contentsButton = screen.getByRole("button", { name: /contents/i });

        fireEvent.click(contentsButton);
        fireEvent.click(
            within(screen.getByRole("dialog")).getByRole("button", {
                name: "Close contents",
            })
        );
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        fireEvent.click(contentsButton);
        const dialog = screen.getByRole("dialog", { name: "Contents" });
        fireEvent.click(dialog.parentElement.firstElementChild);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        fireEvent.click(contentsButton);
        expect(screen.getByRole("dialog", { name: "Contents" })).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});
