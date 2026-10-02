/**
 * Standalone: auth is optional (Supabase Bearer only when configured).
 * These stubs keep leftover server modules from crashing the build.
 */

export type StudioAuthContext = {
  userId: string;
};

type Handler = (
  req: Request,
  ctx: StudioAuthContext,
) => Promise<Response> | Response;

type ParamsHandler<P> = (
  req: Request,
  ctx: StudioAuthContext,
  params: P,
) => Promise<Response> | Response;

const ANON: StudioAuthContext = { userId: "standalone-local-user" };

/** No-op auth wrapper — runs the handler with a local user id. */
export function withStudioAuth(_label: string, handler: Handler) {
  return async (req: Request) => handler(req, ANON);
}

export function withStudioAuthParams<P extends Record<string, string>>(
  _label: string,
  handler: ParamsHandler<P>,
) {
  return async (
    req: Request,
    routeCtx: { params: Promise<P> },
  ) => {
    const params = await routeCtx.params;
    return handler(req, ANON, params);
  };
}
