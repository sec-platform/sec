ARG SEC_BUN_ARCHIVE_URL
ARG SEC_BUN_ARCHIVE_DIGEST
ARG SEC_BUN_EXECUTABLE_DIGEST

FROM runner

ARG SEC_TRUSTED_RUNTIME_SCHEMA
ARG SEC_RUNNER_IMAGE_ID
ARG SEC_BUN_ARCHIVE_URL
ARG SEC_BUN_ARCHIVE_DIGEST
ARG SEC_BUN_VERSION
ARG SEC_BUN_EXECUTABLE_DIGEST

ADD --checksum=${SEC_BUN_ARCHIVE_DIGEST} ${SEC_BUN_ARCHIVE_URL} /tmp/bun.zip

RUN unzip -q /tmp/bun.zip -d /tmp \
    && install -m 0755 /tmp/bun-linux-x64/bun /usr/local/bin/bun \
    && echo "${SEC_BUN_EXECUTABLE_DIGEST#sha256:}  /usr/local/bin/bun" | sha256sum -c - \
    && test "$(bun --version)" = "${SEC_BUN_VERSION}" \
    && rm -rf /tmp/bun.zip /tmp/bun-linux-x64

LABEL sec.trusted-runtime.image-schema="${SEC_TRUSTED_RUNTIME_SCHEMA}" \
      sec.trusted-runtime.base-image-id="${SEC_RUNNER_IMAGE_ID}" \
      sec.trusted-runtime.bun-archive-sha256="${SEC_BUN_ARCHIVE_DIGEST}" \
      sec.trusted-runtime.bun-executable-sha256="${SEC_BUN_EXECUTABLE_DIGEST}" \
      sec.trusted-runtime.bun-version="${SEC_BUN_VERSION}"

ENTRYPOINT []
CMD ["/bin/sleep", "infinity"]
