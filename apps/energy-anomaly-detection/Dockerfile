FROM docker.io/node:lts-alpine

ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN addgroup --system energy && \
    adduser --system -G energy energy

COPY dist/apps/energy-anomaly-detection energy-anomaly-detection/
RUN chown -R energy:energy .

USER energy

CMD ["node", "energy-anomaly-detection/main.cjs"]
