from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from db import get_connection, init_db, row_to_dict, seed_default_user

HOST = "127.0.0.1"
PORT = 8787


class Handler(BaseHTTPRequestHandler):
    server_version = "FlyvBackend/0.1"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _not_found(self) -> None:
        self._send_json(404, {"error": "Not found"})

    def _bad_request(self, message: str) -> None:
        self._send_json(400, {"error": message})

    def _read_json_body(self) -> dict[str, Any] | None:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}

        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._bad_request("Invalid JSON body")
            return None

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._send_json(200, {"status": "ok"})
            return

        if path == "/api/users":
            query = parse_qs(parsed.query)
            name_filter = query.get("q", [None])[0]

            with get_connection() as connection:
                if name_filter:
                    rows = connection.execute(
                        """
                        SELECT * FROM users
                        WHERE lower(full_name) LIKE lower(?)
                        ORDER BY full_name
                        """,
                        (f"%{name_filter}%",),
                    ).fetchall()
                else:
                    rows = connection.execute("SELECT * FROM users ORDER BY full_name").fetchall()

            users = [row_to_dict(row) for row in rows]
            self._send_json(200, {"users": users, "count": len(users)})
            return

        if path.startswith("/api/users/"):
            user_id = path.removeprefix("/api/users/")
            if not user_id.isdigit():
                self._bad_request("User id must be numeric")
                return

            with get_connection() as connection:
                row = connection.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()

            if row is None:
                self._not_found()
                return

            self._send_json(200, {"user": row_to_dict(row)})
            return

        self._not_found()

    def do_POST(self) -> None:
        if self.path != "/api/users":
            self._not_found()
            return

        payload = self._read_json_body()
        if payload is None:
            return

        full_name = str(payload.get("full_name", "")).strip()
        if not full_name:
            self._bad_request("full_name is required")
            return

        data = {
            "full_name": full_name,
            "phone": payload.get("phone"),
            "email": payload.get("email"),
            "address_line1": payload.get("address_line1"),
            "postal_code": payload.get("postal_code"),
            "city": payload.get("city"),
            "municipality_code": payload.get("municipality_code"),
            "municipality_name": payload.get("municipality_name"),
            "farm_number": payload.get("farm_number"),
            "usage_number": payload.get("usage_number"),
            "lease_number": payload.get("lease_number", 0),
            "notes": payload.get("notes"),
        }

        with get_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO users (
                    full_name, phone, email, address_line1, postal_code, city,
                    municipality_code, municipality_name, farm_number, usage_number,
                    lease_number, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data["full_name"],
                    data["phone"],
                    data["email"],
                    data["address_line1"],
                    data["postal_code"],
                    data["city"],
                    data["municipality_code"],
                    data["municipality_name"],
                    data["farm_number"],
                    data["usage_number"],
                    data["lease_number"],
                    data["notes"],
                ),
            )
            user_id = cursor.lastrowid
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

        self._send_json(201, {"user": row_to_dict(row)})

    def do_PUT(self) -> None:
        if not self.path.startswith("/api/users/"):
            self._not_found()
            return

        user_id = self.path.removeprefix("/api/users/")
        if not user_id.isdigit():
            self._bad_request("User id must be numeric")
            return

        payload = self._read_json_body()
        if payload is None:
            return

        allowed_fields = [
            "full_name",
            "phone",
            "email",
            "address_line1",
            "postal_code",
            "city",
            "municipality_code",
            "municipality_name",
            "farm_number",
            "usage_number",
            "lease_number",
            "notes",
        ]

        updates = {key: payload[key] for key in allowed_fields if key in payload}
        if not updates:
            self._bad_request("No updatable fields provided")
            return

        if "full_name" in updates:
            updates["full_name"] = str(updates["full_name"]).strip()
            if not updates["full_name"]:
                self._bad_request("full_name cannot be empty")
                return

        set_clause = ", ".join([f"{field} = ?" for field in updates.keys()])
        values = list(updates.values())
        values.extend([int(user_id)])

        with get_connection() as connection:
            existing = connection.execute("SELECT id FROM users WHERE id = ?", (int(user_id),)).fetchone()
            if existing is None:
                self._not_found()
                return

            connection.execute(
                f"""
                UPDATE users
                SET {set_clause}, updated_at = datetime('now')
                WHERE id = ?
                """,
                values,
            )
            row = connection.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()

        self._send_json(200, {"user": row_to_dict(row)})


def run() -> None:
    init_db()
    seed_default_user()

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Backend API running on http://{HOST}:{PORT}")
    print("Endpoints: /health, /api/users, /api/users/<id>")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down backend API.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
