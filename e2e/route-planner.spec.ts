import { expect, test, type Page } from "@playwright/test";
import type { RouteResult, StopDetail } from "../src/lib/types";

async function selectStop(page: Page, label: "From" | "To", code: string, keyboard = false) {
  await page.getByLabel(label, { exact: true }).fill(` ${code} `);
  const option = page.locator(".dropdown-item").filter({ hasText: code }).first();
  await expect(option).toBeVisible();
  if (keyboard) {
    await option.focus();
    await option.press("Enter");
  } else {
    await option.click();
  }
  await expect(page.getByRole("button", { name: `Clear ${label.toLowerCase()} stop` })).toBeVisible();
}

async function selectJourney(page: Page) {
  await page.goto("/");
  await selectStop(page, "From", "1000417", true);
  await selectStop(page, "To", "1001200");
}

test.beforeEach(async ({ page }) => {
  await page.route("https://*.tile.openstreetmap.org/**", (route) => route.abort());
});

test("a real journey follows stored road bends and fits desktop and mobile maps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await selectJourney(page);
  const responsePromise = page.waitForResponse("**/api/routes/find");
  await page.getByRole("button", { name: "Find Route", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const { route }: { route: RouteResult } = await response.json();
  expect(route.segments[0].stops[0].id).toBe(105);
  expect(route.segments.at(-1)!.stops.at(-1)!.id).toBe(1439);
  const rides = route.segments.filter((segment) => segment.busId !== -1);
  expect(rides.some((segment) => segment.geometry.length > segment.stops.length)).toBe(true);
  const lines = page.locator('.leaflet-overlay-pane path[stroke-width="7"]');
  await expect(lines).toHaveCount(rides.length);
  await expect.poll(() => lines.evaluateAll((paths) => paths.some((path) =>
    (path.getAttribute("d")?.match(/[ML]/g)?.length ?? 0) > 10))).toBe(true);
  await expect(page.locator(".journey-card")).toBeVisible();
  await expect(page.getByText(/Includes about .* min for transfers/)).toBeVisible();

  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const map = document.querySelector(".leaflet-container")!.getBoundingClientRect();
      return map.width > 100 && [...document.querySelectorAll(".map-marker-start,.map-marker-end")].every((marker) => {
        const box = marker.getBoundingClientRect();
        return box.left >= map.left && box.right <= map.right && box.top >= map.top && box.bottom <= map.bottom;
      });
    })).toBe(true);
  }
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Clear to stop" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(0);
  await expect(lines).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("changing stops cancels an outstanding search and permits a new one", async ({ page }) => {
  await selectJourney(page);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  await page.route("**/api/routes/find", async (route) => {
    if (++calls === 1) {
      started();
      await held;
      await route.fulfill({ status: 500, json: { error: "Stale response" } });
    } else {
      await route.continue();
    }
  });
  const find = page.getByRole("button", { name: "Find Route", exact: true });
  await find.click();
  await firstStarted;
  await page.getByRole("button", { name: "Clear to stop" }).click();
  await expect(page.getByText("Finding best route...")).toHaveCount(0);
  await selectStop(page, "To", "1001200");
  await expect(find).toBeEnabled();
  await find.click();
  await expect(page.locator(".journey-card")).toBeVisible();
  release();
  await expect(page.locator(".error-msg")).toHaveCount(0);
  await expect(page.locator(".journey-card")).toBeVisible();
  await page.getByRole("button", { name: "Swap stops" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(0);
});

test("a failed stop request is visible and cannot select an unavailable nearest stop", async ({ page }) => {
  await page.route("**/api/stops", (route) => route.fulfill({ status: 500, json: { error: "Database unavailable" } }));
  await page.goto("/");
  await expect(page.getByText("Failed to load bus stops")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use My Location" })).toBeDisabled();
});

test("walking connections expose the actual alighting and boarding stops", async ({ page, request }) => {
  const { stops }: { stops: StopDetail[] } = await (await request.get("/api/stops")).json();
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const route: RouteResult = {
    segments: [[10, [105, 77]], [-1, [77, 102]], [20, [102, 1439]]].map(([busId, ids]) => {
      const segmentStops = (ids as number[]).map((id) => byId.get(id)!);
      return { busId: busId as number, busNumber: String(busId), directionTypeId: busId === -1 ? null : 1,
        geometry: segmentStops, stops: segmentStops, distance: 1, time: 2 };
    }),
    totalDistance: 3, totalTime: 11, totalTransfers: 1, totalStops: 4,
  };
  await page.route("**/api/routes/find", (request) => request.fulfill({ json: { route } }));
  await selectJourney(page);
  await page.getByRole("button", { name: "Find Route", exact: true }).click();
  const card = page.locator(".journey-card");
  await expect(card.getByText(byId.get(77)!.name, { exact: true })).toBeVisible();
  await expect(card.getByText(byId.get(102)!.name, { exact: true })).toBeVisible();
  await expect(card.getByText("Continue on foot")).toBeVisible();
  await expect(card.getByText("Board Bus 20")).toBeVisible();
});
