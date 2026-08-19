FROM oven/bun@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834 AS bun-runtime

FROM sec-actions-runner@sha256:418e9f00110157ff610061685f9175a1af6966baa77e6d153eb43bd49893f63f

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

LABEL sec.trusted-runtime.image-schema="sec-trusted-runtime-container-v1" \
      sec.trusted-runtime.base-image-id="sha256:418e9f00110157ff610061685f9175a1af6966baa77e6d153eb43bd49893f63f" \
      sec.trusted-runtime.bun-image-manifest="sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834" \
      sec.trusted-runtime.bun-version="1.3.14"

ENTRYPOINT []
CMD ["/bin/sleep", "infinity"]
