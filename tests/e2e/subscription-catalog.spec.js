import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

test("subscription catalog filters, prefills editable details, and supports keyboard selection", async ({ page }) => {
  await openTracker(page);

  const nameField = page.getByRole("combobox", { name: "Name", exact: true });
  const initialBillingDate = await page.getByLabel("Next billing date", { exact: true }).inputValue();

  await nameField.focus();
  const suggestions = page.getByRole("listbox", { name: "Subscription suggestions", exact: true });
  await expect(suggestions).toBeVisible();
  await expect(suggestions.getByRole("option")).toHaveCount(6);

  await nameField.fill("spot");
  const spotify = suggestions.getByRole("option").filter({ hasText: "Spotify" });
  await expect(spotify).toHaveCount(1);
  const spotifyMark = spotify.locator('[data-subscription-mark="spotify"]');
  await expect(spotifyMark).toHaveAttribute("data-company-icon", "true");
  await expect(spotifyMark.locator("svg")).toBeVisible();
  await spotify.click();

  await expect(suggestions).toBeHidden();
  await expect(nameField).toHaveValue("Spotify");
  await expect(page.getByRole("spinbutton", { name: "Amount", exact: true })).toHaveValue("10.99");
  await expect(page.getByRole("textbox", { name: "Category", exact: true })).toHaveValue("Music");
  await expect(page.getByRole("textbox", { name: "Tags", exact: true })).toHaveValue("personal, audio");
  await expect(page.getByRole("button", { name: "Monthly", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lime", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Next billing date", { exact: true })).toHaveValue(initialBillingDate);

  await nameField.fill("git");
  await expect(suggestions.getByRole("option").filter({ hasText: "GitHub Copilot" })).toHaveCount(1);
  await nameField.press("Enter");
  await expect(nameField).toHaveValue("GitHub Copilot");
  const githubMark = page.getByRole("complementary").locator('[data-subscription-mark="github-copilot"]');
  await expect(githubMark).toHaveAttribute("data-company-icon", "true");
  await expect(githubMark.locator("svg")).toBeVisible();

  await nameField.fill("uber");
  const uber = suggestions.getByRole("option").filter({ hasText: "Uber One" });
  await expect(uber).toHaveCount(1);
  await expect(uber.locator('[data-subscription-mark="uber-one"] svg')).toBeVisible();

  await nameField.fill("Private VPN");
  await expect(suggestions).toBeHidden();
  await expect(nameField).toHaveValue("Private VPN");
});
