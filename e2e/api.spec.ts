import { expect, test } from "@playwright/test";

test("route endpoints reject malformed inputs and still handle concurrent valid requests", async ({ request }) => {
  for (const data of ["{", "null", "[]", '{"fromStopId":"105","toStopId":1439}',
    '{"fromStopId":1.5,"toStopId":1439}', '{"fromStopId":105,"toStopId":105}']) {
    const response = await request.post("/api/routes/find", { data, headers: { "Content-Type": "application/json" } });
    expect(response.status(), data).toBe(400);
  }
  const responses = await Promise.all([[105, 1439], [1439, 631], [3837, 3831]].map(([fromStopId, toStopId]) =>
    request.post("/api/routes/find", { data: { fromStopId, toStopId } })));
  for (const response of responses) {
    expect(response.status()).toBe(200);
    const { route } = await response.json();
    expect(route.totalDistance).toBeLessThan(100);
  }
  const missing = await request.post("/api/routes/find", { data: { fromStopId: 99999999, toStopId: 105 } });
  expect(missing.status()).toBe(404);
});

test("nearby and geometry endpoints reject invalid numbers before querying data", async ({ request }) => {
  for (const query of ["", "lat=Infinity&lng=49", "lat=91&lng=49", "lat=40x&lng=49",
    "lat=40&lng=181", "lat=40&lng=49&radius=-1", "lat=40&lng=49&radius=Infinity",
    "lat=40&lng=49&limit=-1", "lat=40&lng=49&limit=1.5", "lat=&lng=49"]) {
    expect((await request.get(`/api/stops/nearby?${query}`)).status(), query).toBe(400);
  }
  for (const query of ["", "busId=1junk", "busId=1.5", "busId=1&direction=3", "busId=1&direction="]) {
    expect((await request.get(`/api/routes/geometry?${query}`)).status(), query).toBe(400);
  }
  const nearby = await request.get("/api/stops/nearby?lat=40.4&lng=49.8&radius=10&limit=3");
  expect(nearby.status()).toBe(200);
  const { stops } = await nearby.json();
  expect(stops).toHaveLength(3);
  expect(stops[0].distance).toBeLessThanOrEqual(stops[1].distance);
  const geometry = await request.get("/api/routes/geometry?busId=1&direction=1");
  expect(geometry.status()).toBe(200);
  expect((await geometry.json()).coordinates.length).toBeGreaterThan(2);
});
