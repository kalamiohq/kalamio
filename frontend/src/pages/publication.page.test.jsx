import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext } from "react";
import PublicationPage from "./publication.page.jsx";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("../common/api", () => ({
  default: { post: (...args) => post(...args) },
}));

vi.mock("../App", async () => {
  const { createContext } = await import("react");
  return {
    UserContext: createContext({
      userAuth: { username: "viewer", access_token: "" },
      setUserAuth: () => {},
    }),
  };
});

const publicPublication = {
  _id: "pub1",
  title: "My Pub",
  slug: "my-pub",
  description: "A publication",
  banner: "",
  profile_photo: "",
  owner: { _id: "owner1", personal_info: { username: "owner", fullname: "Owner" } },
  tags: [],
  total_posts: 1,
  total_subscribers: 2,
  visibility: "public",
};

const privatePublication = { ...publicPublication, visibility: "private" };

const renderPublication = (publication) => {
  post.mockImplementation(async (route) => {
    if (route === "/publication/get") return { data: { publication } };
    if (route === "/publication/blogs") return { data: { blogs: [] } };
    if (route === "/publication/blogs-count") return { data: { totalDocs: 0 } };
    if (route === "/collection/publication-collections") return { data: { collections: [] } };
    return { data: {} };
  });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/publication/my-pub"]}>
        <Routes>
          <Route path="/publication/:slug" element={<PublicationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const rssLink = () =>
  document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]');

describe("publication page RSS feed", () => {
  beforeEach(() => {
    post.mockReset();
    rssLink()?.remove();
  });

  it("advertises the feed in <head> for a public publication, without a visible button", async () => {
    renderPublication(publicPublication);
    await waitFor(() =>
      expect(rssLink()).toHaveAttribute("href", expect.stringContaining("/api/v1/feed/publication/my-pub.xml")),
    );
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });

  it("does not advertise a feed for a private publication", async () => {
    renderPublication(privatePublication);
    await waitFor(() => expect(screen.getByText("My Pub")).toBeInTheDocument());
    expect(rssLink()).toBeNull();
  });
});
