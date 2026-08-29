import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  deleteRun: vi.fn(),
  getRun: vi.fn(),
}));

vi.mock("@/persistence/postgres-repository", () => ({
  PostgresPipelineRepository: class {
    deleteRun = repository.deleteRun;
    getRun = repository.getRun;
  },
}));

import { DELETE } from "./route";

const runId = "00000000-0000-4000-8000-000000000001";

function removeRun(id: string) {
  return DELETE(
    new Request(`http://localhost/api/runs/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
}

describe("DELETE /api/runs/[id]", () => {
  beforeEach(() => {
    repository.deleteRun.mockReset();
  });

  it("deletes an existing run", async () => {
    repository.deleteRun.mockResolvedValue(true);

    const response = await removeRun(runId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, id: runId });
    expect(repository.deleteRun).toHaveBeenCalledWith(runId);
  });

  it("returns not found for invalid or absent run IDs", async () => {
    const invalidResponse = await removeRun("not-a-run-id");
    expect(invalidResponse.status).toBe(404);
    expect(repository.deleteRun).not.toHaveBeenCalled();

    repository.deleteRun.mockResolvedValue(false);
    const missingResponse = await removeRun(runId);
    expect(missingResponse.status).toBe(404);
  });
});
