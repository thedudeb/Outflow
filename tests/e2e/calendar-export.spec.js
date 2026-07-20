import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openTracker } from "./helpers";

function parseCalendar(value) {
  const text = value.replace(/\r?\n[ \t]/g, "").replaceAll("\r\n", "\n");
  const events = [...text.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)].map((match) => {
    const fields = {};
    for (const line of match[1].split("\n")) {
      const separator = line.indexOf(":");
      if (separator === -1) continue;
      const rawKey = line.slice(0, separator);
      const key = rawKey.split(";", 1)[0];
      fields[key] = line.slice(separator + 1);
    }
    return fields;
  });
  return { text, events };
}

async function downloadCalendar(page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ics", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe("outflow-personal-calendar.ics");
  expect(downloadPath).not.toBeNull();
  return parseCalendar(await readFile(downloadPath, "utf8"));
}

function eventFor(events, subscriptionName) {
  return events.find((event) => event.SUMMARY?.startsWith(`${subscriptionName} /`));
}

test("calendar exports preserve identity, publish edits, and isolate paused schedules", async ({ page }) => {
  await openTracker(page);
  await page.getByRole("button", { name: "Export calendar", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Calendar export" });
  await expect(dialog.getByText(/Events\s+4/)).toBeVisible();
  await expect(dialog.getByText(/Paused\s+0/)).toBeVisible();

  const initial = await downloadCalendar(page);
  expect(initial.text).toContain("METHOD:PUBLISH");
  expect(initial.text).toContain("X-WR-CALNAME:Outflow / Personal");
  expect(initial.events).toHaveLength(4);
  expect(eventFor(initial.events, "Notion Plus")).toBeUndefined();

  const initialNetflix = eventFor(initial.events, "Netflix");
  expect(initialNetflix).toMatchObject({
    RRULE: "FREQ=MONTHLY",
    STATUS: "CONFIRMED",
    CLASS: "PRIVATE",
    TRANSP: "TRANSPARENT",
    "X-MICROSOFT-CDO-BUSYSTATUS": "FREE",
  });
  expect(initialNetflix.UID).toMatch(/^netflix\..+@outflow\.local$/);
  expect(initialNetflix.DTSTART).toMatch(/^\d{8}$/);
  expect(initialNetflix.CATEGORIES).toContain("Outflow");
  expect(initialNetflix.CATEGORIES).toContain("Streaming");
  expect(initialNetflix.DESCRIPTION).toContain("Personal / personal / on this device");

  const netflixCard = page.getByRole("article").filter({ hasText: "Netflix" });
  await netflixCard.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Next billing date", exact: true }).fill("2030-12-15");
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Commit changes", exact: true }).click();
  await page.getByRole("button", { name: "Export calendar", exact: true }).click();

  const revised = await downloadCalendar(page);
  const revisedNetflix = eventFor(revised.events, "Netflix");
  expect(revisedNetflix.UID).toBe(initialNetflix.UID);
  expect(revisedNetflix.DTSTART).toBe("20301215");
  expect(Number(revisedNetflix.SEQUENCE)).toBe(Number(initialNetflix.SEQUENCE) + 1);
  expect(revisedNetflix["LAST-MODIFIED"]).not.toBe(initialNetflix["LAST-MODIFIED"]);

  await page.getByRole("button", { name: "Export calendar", exact: true }).click();
  const pausedToggle = page.getByRole("dialog", { name: "Calendar export" }).getByRole("checkbox", { name: /Download paused schedules/ });
  await pausedToggle.check();
  await expect(page.getByRole("dialog", { name: "Calendar export" }).getByText(/Events\s+5/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Calendar export" }).getByText(/Paused\s+1/)).toBeVisible();

  const withPaused = await downloadCalendar(page);
  expect(withPaused.events).toHaveLength(5);
  const notion = eventFor(withPaused.events, "Notion Plus");
  expect(notion).toMatchObject({
    RRULE: "FREQ=YEARLY",
    STATUS: "TENTATIVE",
  });
  expect(notion.DESCRIPTION).toContain("Paused schedule");
});
