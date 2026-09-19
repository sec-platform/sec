# License map

SEC uses two standard licenses, selected by the kind of material rather than by repository location alone.

## Software and executable engineering material

Repository-owned source code, tests, tools, workflow and build configuration, machine-consumed examples, schemas, fixtures, and other executable or implementation material are licensed under the [Mozilla Public License 2.0](../LICENSE). The SPDX identifier is `MPL-2.0`.

MPL-2.0 applies without the Exhibit B “Incompatible With Secondary Licenses” notice. Modifications to MPL-covered source files remain governed by MPL-2.0 when distributed, while separate files may be combined with them in a Larger Work under other terms as allowed by the license.

Using SEC to inspect, generate, compile, or modify a target workspace does not by itself apply MPL-2.0 to that workspace or its output. Material copied from SEC, including example code or implementation fragments, retains its applicable license.

## Documentation and specifications

Repository-owned Markdown, the `docs/**` and `alternatives/**` design corpora, `.documentation/**` metadata, diagrams embedded in those works, and other human-readable specifications are licensed under [Creative Commons Attribution 4.0 International](CC-BY-4.0.txt). The SPDX identifier is `CC-BY-4.0`.

When sharing or adapting this material, credit **Jeremy Yang**, identify the work as **Engineering Workspace Compiler (SEC)**, link to `https://github.com/sec-platform/sec` and `https://creativecommons.org/licenses/by/4.0/`, and indicate whether changes were made. Attribution must not imply endorsement.

## Release packaging

Packaging does not relicense repository material. The SEC common release set records the runtime member as `MPL-2.0` and the documentation member as `CC-BY-4.0`; the documentation artifact includes the CC BY 4.0 license text and the required Jeremy Yang / Engineering Workspace Compiler (SEC) attribution. A common archive or root manifest therefore does not collapse the two licensing boundaries. Generated machine-readable release manifests are release/build metadata and follow the software/executable-material classification when copyright applies.

## Machine-readable classification

[`REUSE.toml`](../REUSE.toml) records the repository-wide SPDX classification. A more specific per-file SPDX notice or an applicable third-party notice takes precedence for that material.

Third-party dependencies and incorporated third-party materials remain under their own licenses. Package-manager metadata and lockfiles identify dependencies; those dependencies are not relicensed by this repository.
