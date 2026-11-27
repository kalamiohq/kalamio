import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import PageNotFound from "./404.page.jsx";

const LocationDisplay = () => {
    const { pathname } = useLocation();
    return <div data-testid="location">{pathname}</div>;
};

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={["/does-not-exist"]}>
            <PageNotFound />
            <LocationDisplay />
        </MemoryRouter>,
    );

describe("404 page", () => {
    it("has one home action and a search box", () => {
        renderPage();
        expect(screen.getByText("Page not found")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
        expect(screen.queryByRole("link", { name: "home page" })).not.toBeInTheDocument();
        expect(screen.getByLabelText("Search stories")).toBeInTheDocument();
    });

    it("opens /search/<query> on Enter and stays put on an empty search", async () => {
        const user = userEvent.setup();
        renderPage();
        const search = screen.getByLabelText("Search stories");
        await user.type(search, "react{Enter}");
        expect(screen.getByTestId("location")).toHaveTextContent("/search/react");
    });

    it("does not navigate on an empty search", async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByLabelText("Search stories"));
        await user.keyboard("{Enter}");
        expect(screen.getByTestId("location")).toHaveTextContent("/does-not-exist");
    });

    it("encodes queries that would break the :query route param", async () => {
        const user = userEvent.setup();
        renderPage();
        await user.type(screen.getByLabelText("Search stories"), "a/b{Enter}");
        expect(screen.getByTestId("location")).toHaveTextContent("/search/a%2Fb");
    });
});
