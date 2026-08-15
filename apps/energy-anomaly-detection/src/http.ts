import type {ServerResponse} from 'node:http';

export function respond(
  response: ServerResponse,
  statusCode: number,
  body?: Record<string, unknown>,
): void {
  if (body === undefined) {
    response.writeHead(statusCode);
    response.end();
    return;
  }

  response.writeHead(statusCode, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(body));
}
