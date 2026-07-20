FROM docker.io/node:lts-alpine

ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN addgroup --system energy && \
    adduser --system -G energy energy

COPY dist/apps/energy-ingestion energy-ingestion/
RUN chown -R energy:energy .

USER energy

CMD ["node", "energy-ingestion/main.cjs"]
