"""Stage a new Jina pgvector collection; leave the original collection untouched."""

import argparse
import os
import time

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from secret_guard import find_secrets

from norn_m.embeddings.jina import MAX_BATCH, MODEL, JinaEmbeddingError
from norn_m.utils.factory import EmbedderFactory


def open_database():
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
        dbname=os.getenv("POSTGRES_DB", "postgres"),
        connect_timeout=5,
        autocommit=True,
    )


def prepare(conn, source, target, target_name, signature):
    with conn.transaction():
        conn.execute(sql.SQL("SELECT id, vector, payload FROM {} LIMIT 0").format(source))
        row = conn.execute("SELECT to_regclass(%s)", (target.as_string(conn),)).fetchone()
        if row[0] is None:
            conn.execute(sql.SQL("CREATE TABLE {} (LIKE {} INCLUDING ALL)").format(target, source))
            conn.execute(sql.SQL("COMMENT ON TABLE {} IS {}").format(target, sql.Literal(signature)))
        comment = conn.execute("SELECT obj_description(to_regclass(%s), 'pg_class')", (target.as_string(conn),))
        if comment.fetchone()[0] != signature:
            raise SystemExit(
                f"Refusing to use existing collection {target_name!r} without the expected migration marker"
            )


def sync_vectors(conn, source, target, embedder):
    total = 0
    while True:
        rows = conn.execute(
            sql.SQL(
                "SELECT s.id, s.payload FROM {} s LEFT JOIN {} d USING (id) "
                "WHERE d.id IS NULL OR d.vector IS NULL OR (s.payload->>'data') IS DISTINCT FROM (d.payload->>'data') "
                "ORDER BY s.id LIMIT %s"
            ).format(source, target),
            (MAX_BATCH,),
        ).fetchall()
        if not rows:
            return total

        texts = [payload.get("data") if isinstance(payload, dict) else None for _, payload in rows]
        if any(not isinstance(text, str) or not text.strip() for text in texts):
            raise SystemExit("Source contains an empty or invalid memory. No vectors were saved for this batch.")
        if any(find_secrets(text) for text in texts):
            raise SystemExit("Source contains a possible credential. No text from this batch was sent to Jina.")
        for attempt in range(4):
            try:
                vectors = embedder.embed_batch(texts)
                break
            except JinaEmbeddingError as exc:
                if not exc.retryable or attempt == 3:
                    raise SystemExit(str(exc)) from None
                delay = 2**attempt
                print(f"{exc}; retrying in {delay}s", flush=True)
                time.sleep(delay)
        values = [(memory_id, str(vector), Jsonb(payload)) for (memory_id, payload), vector in zip(rows, vectors)]
        with conn.transaction(), conn.cursor() as cur:
            cur.executemany(
                sql.SQL(
                    "INSERT INTO {} (id, vector, payload) VALUES (%s, %s::vector, %s) "
                    "ON CONFLICT (id) DO UPDATE SET vector = excluded.vector, payload = excluded.payload"
                ).format(target),
                values,
            )
        total += len(rows)
        if total % (MAX_BATCH * 10) == 0:
            print(f"Re-embedded {total} memories this run", flush=True)


def finalize(conn, source, target, embedder):
    with conn.transaction():
        conn.execute("SET LOCAL lock_timeout = '5s'")
        conn.execute(sql.SQL("LOCK TABLE {} IN SHARE MODE").format(source))
        remaining = sync_vectors(conn, source, target, embedder)
        conn.execute(
            sql.SQL("DELETE FROM {} d WHERE NOT EXISTS (SELECT 1 FROM {} s WHERE s.id = d.id)").format(target, source)
        )
        conn.execute(
            sql.SQL(
                "UPDATE {} d SET payload = s.payload FROM {} s WHERE d.id = s.id AND d.payload IS DISTINCT FROM s.payload"
            ).format(target, source)
        )
        row = conn.execute(
            sql.SQL(
                "SELECT count(s.id), count(d.id), count(*) FILTER (WHERE s.id IS NULL OR d.id IS NULL "
                "OR s.payload IS DISTINCT FROM d.payload OR d.vector IS NULL OR vector_dims(d.vector) <> %s) "
                "FROM {} s FULL JOIN {} d USING (id)"
            ).format(source, target),
            (embedder.config.embedding_dims,),
        ).fetchone()
        if row is None or row[2]:
            raise SystemExit("Validation failed. The final synchronization was rolled back.")
        print(
            f"Validated {row[0]} source and {row[1]} target memories, {remaining} re-embedded in final sync", flush=True
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--dimensions", type=int, default=768)
    parser.add_argument(
        "--finalize", action="store_true", help="Run only while the old API and all other writers are stopped"
    )
    args = parser.parse_args()
    if args.source == args.target or not all(0 < len(n.encode()) <= 63 for n in (args.source, args.target)):
        parser.error("source and target must be different PostgreSQL collection names (1–63 bytes)")
    source, target = sql.Identifier("public", args.source), sql.Identifier("public", args.target)
    signature = f"norn-m:reembed:{source.as_string()}:{MODEL}:text-matching:{args.dimensions}"
    embedder = EmbedderFactory.create("jina", {"model": MODEL, "embedding_dims": args.dimensions}, None)
    try:
        with open_database() as conn:
            lock = conn.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (f"norn-m:reembed:{target.as_string()}",))
            if not lock.fetchone()[0]:
                raise SystemExit("Another migration owns this target collection")
            prepare(conn, source, target, args.target, signature)
            dims = conn.execute(
                "SELECT atttypmod FROM pg_attribute WHERE attrelid=to_regclass(%s) AND attname='vector' AND NOT attisdropped",
                (target.as_string(conn),),
            ).fetchone()
            if dims != (args.dimensions,):
                raise SystemExit(f"The source and target vector columns must have width {args.dimensions}")
            if args.finalize:
                finalize(conn, source, target, embedder)
                conn.execute(sql.SQL("ANALYZE {}").format(target))
            else:
                total = sync_vectors(conn, source, target, embedder)
                print(
                    f"Staged {total} freshly embedded memories. Run --finalize with writers stopped before switching."
                )
    finally:
        embedder.close()


if __name__ == "__main__":
    main()
