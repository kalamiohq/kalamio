import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createContext } from "react";
import ProfilePage from "./profile.page.jsx";

const { useUserProfile, useUserBlogs } = vi.hoisted(() => ({
  useUserProfile: vi.fn(),
  useUserBlogs: vi.fn(),
}));

vi.mock("../hooks/queries", () => ({
  useUserProfile: (...args) => useUserProfile(...args),
  useUserBlogs: (...args) => useUserBlogs(...args),
  useUserPublications: () => ({ data: [] }),
  useUserCollections: () => ({ data: [] }),
  useFollowsBack: () => ({ data: false }),
  useBlockStatus: () => ({ data: { is_blocked: false } }),
}));

vi.mock("../hooks/mutations", () => ({
  useBlockAction: () => ({ mutate: vi.fn() }),
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

const publicProfile = {
  personal_info: {
    fullname: "Ada Lovelace",
    username: "ada",
    profile_img: "",
    bio: "Writer",
  },
  account_info: { total_posts: 1, total_reads: 2, total_followers: 3, total_following: 4 },
  account_status: { status: "active" },
  privacy_settings: { show_profile: "everyone" },
  social_links: {},
  joinedAt: "2026-01-01",
};

const privateProfile = {
  ...publicProfile,
  privacy_settings: { show_profile: "logged_in" },
};

const deactivatedProfile = {
  ...publicProfile,
  account_status: { status: "deactivated" },
};

const renderProfile = (profile) => {
  useUserProfile.mockReturnValue({ data: profile, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  useUserBlogs.mockReturnValue({ data: { blogs: [] }, isLoading: false, fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false });
  return render(
    <MemoryRouter initialEntries={["/user/ada"]}>
      <ProfilePage />
    </MemoryRouter>,
  );
};

describe("profile page RSS link", () => {
  beforeEach(() => {
    useUserProfile.mockReset();
    useUserBlogs.mockReset();
  });

  it("shows an RSS link for a public active profile", async () => {
    renderProfile(publicProfile);
    await waitFor(() => expect(screen.getByText("RSS")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /rss/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/v1/feed/user/ada.xml"),
    );
  });

  it("does not show an RSS link for a logged-in-only profile", async () => {
    renderProfile(privateProfile);
    await waitFor(() => expect(screen.getByText("@ada")).toBeInTheDocument());
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });

  it("does not show an RSS link for a deactivated profile", async () => {
    renderProfile(deactivatedProfile);
    await waitFor(() => expect(screen.getByText("@ada")).toBeInTheDocument());
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });
});
