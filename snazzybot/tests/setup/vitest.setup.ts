// JSDOM + fetch polyfills
import "whatwg-fetch";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../utils/msw/node";

// Start MSW (node) for unit/integration tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
