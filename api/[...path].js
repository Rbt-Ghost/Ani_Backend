import { handleRequest } from "../server.js";

export default function handler(req, res) {
  return handleRequest(req, res).catch((error) => {
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected server error." }));
  });
}