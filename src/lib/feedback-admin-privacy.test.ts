import { describe, expect, it } from "vite-plus/test";
import { isFeedbackAdminPath } from "./feedback-admin-privacy";
import { isFeedbackPath } from "./feedback-privacy";
describe("separate admin feedback privacy boundary", () => {
  it.each(["/admin/feedback", "/ADMIN/FEEDBACK/", "/admin/%66eedback", "/api/admin/feedback", "/API/ADMIN/FEEDBACK/"])("protects %s without stripping human auth", path => {
    expect(isFeedbackAdminPath(path)).toBe(true);
    expect(isFeedbackPath(path)).toBe(false);
  });
  it.each(["/feedback", "/api/feedback", "/admin/feedback-other", "/admin", "/%invalid"])("does not misclassify %s", path => expect(isFeedbackAdminPath(path)).toBe(false));
});
