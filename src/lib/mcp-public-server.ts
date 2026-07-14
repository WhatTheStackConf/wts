import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CONFERENCE_GUIDE_URIS,
  ProgrammeUnavailableError,
  type ConferenceGuideService,
} from "~/lib/conference-guide";

function resourceContents(uri: URL, value: unknown) {
  return {
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(value, null, 2),
    }],
  };
}

async function readGuideResource(uri: URL, read: () => Promise<unknown>) {
  try {
    return resourceContents(uri, await read());
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof ProgrammeUnavailableError) {
      throw new McpError(
        ErrorCode.InternalError,
        "programme_unavailable: The Published conference programme is temporarily unavailable.",
      );
    }
    throw new McpError(ErrorCode.InternalError, "conference_guide_unavailable");
  }
}

function slugVariable(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    throw new McpError(ErrorCode.InvalidParams, "invalid_slug: A public slug is required.");
  }
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, "invalid_slug: The public slug is malformed.");
  }
  if (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new McpError(ErrorCode.InvalidParams, "invalid_slug: Use a lowercase public slug.");
  }
  return slug;
}

export function buildPublicMcpServer(guide: ConferenceGuideService) {
  const server = new McpServer({
    name: "whatthestack-conference-guide",
    version: "1.0.0",
  });
  const resourceMetadata = {
    mimeType: "application/json",
  };

  server.registerResource(
    "conference-guide-index",
    CONFERENCE_GUIDE_URIS.index,
    {
      ...resourceMetadata,
      title: "WhatTheStack Conference Guide",
      description: "Validated attendee logistics and links to the current Published programme.",
    },
    (uri) => readGuideResource(uri, () => guide.getIndex()),
  );
  server.registerResource(
    "published-agenda",
    CONFERENCE_GUIDE_URIS.agenda,
    {
      ...resourceMetadata,
      title: "Published Agenda",
      description: "Published Conference Days and Agenda Slots in Europe/Skopje.",
    },
    (uri) => readGuideResource(uri, () => guide.getAgenda()),
  );
  server.registerResource(
    "published-partners",
    CONFERENCE_GUIDE_URIS.partners,
    {
      ...resourceMetadata,
      title: "Published Partners",
      description: "Published conference Partners grouped by their public classification.",
    },
    (uri) => readGuideResource(uri, () => guide.getPartners()),
  );
  server.registerResource(
    "published-session",
    new ResourceTemplate(CONFERENCE_GUIDE_URIS.sessionTemplate, { list: undefined }),
    {
      ...resourceMetadata,
      title: "Published Session by slug",
      description: "One Published Session and its public Speakers and Agenda placement.",
    },
    (uri, variables) => readGuideResource(uri, async () => {
      const slug = slugVariable(variables.slug);
      const session = await guide.getSession(slug);
      if (!session) {
        throw new McpError(ErrorCode.InvalidParams, `resource_not_found: Published Session '${slug}' was not found.`);
      }
      return session;
    }),
  );
  server.registerResource(
    "published-speaker",
    new ResourceTemplate(CONFERENCE_GUIDE_URIS.speakerTemplate, { list: undefined }),
    {
      ...resourceMetadata,
      title: "Published Speaker by slug",
      description: "One Published Speaker and their Published Sessions.",
    },
    (uri, variables) => readGuideResource(uri, async () => {
      const slug = slugVariable(variables.slug);
      const speaker = await guide.getSpeaker(slug);
      if (!speaker) {
        throw new McpError(ErrorCode.InvalidParams, `resource_not_found: Published Speaker '${slug}' was not found.`);
      }
      return speaker;
    }),
  );

  return server;
}
