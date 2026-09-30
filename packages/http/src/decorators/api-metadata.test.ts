import { describe, expect, it } from "vitest";
import {
  ApiOperation,
  ApiTags,
  getApiOperation,
  getClassApiTags,
  getMethodApiTags,
} from "./api-metadata.js";

describe("@ApiOperation", () => {
  it("records options for the decorated method", () => {
    class Controller {
      @ApiOperation({ summary: "List posts", operationId: "listPosts" })
      list(): void {}

      undecorated(): void {}
    }

    expect(getApiOperation(Controller.prototype, "list")).toEqual({
      summary: "List posts",
      operationId: "listPosts",
    });
    expect(getApiOperation(Controller.prototype, "undecorated")).toBeUndefined();
  });
});

describe("@ApiTags", () => {
  it("records tags applied at the class level", () => {
    @ApiTags("posts")
    class Controller {}

    expect(getClassApiTags(Controller)).toEqual(["posts"]);
  });

  it("records tags applied at the method level, independently of class-level tags", () => {
    class Controller {
      @ApiTags("admin")
      protectedRoute(): void {}

      openRoute(): void {}
    }

    expect(getMethodApiTags(Controller.prototype, "protectedRoute")).toEqual(["admin"]);
    expect(getMethodApiTags(Controller.prototype, "openRoute")).toEqual([]);
  });

  it("returns an empty array for an undecorated class", () => {
    class Controller {}

    expect(getClassApiTags(Controller)).toEqual([]);
  });

  it("accepts multiple tags in one call", () => {
    @ApiTags("posts", "content")
    class Controller {}

    expect(getClassApiTags(Controller)).toEqual(["posts", "content"]);
  });

  it("concatenates class-level and method-level tags rather than one replacing the other", () => {
    @ApiTags("posts")
    class Controller {
      @ApiTags("admin")
      remove(): void {}
    }

    const classTags = getClassApiTags(Controller);
    const methodTags = getMethodApiTags(Controller.prototype, "remove");

    expect([...classTags, ...methodTags]).toEqual(["posts", "admin"]);
  });
});
