# Catalog synchronization preconditions

## Historical deletions

The product and variant exclusion migrations create empty tombstone tables; they
do not reconstruct deletions made before those migrations. Before enabling the
corrected catalog synchronization for the first time, identify any previously
deleted product and variant IDs from an auditable source, such as a dated
database backup or reliable deletion log. Do not infer deletion from absence in
the current database or from the static catalog, and do not seed guessed IDs.

If no evidence-backed ID list is available, historical deletion protection
remains an unresolved deployment precondition. Keep automatic synchronization
disabled until the IDs are verified and an authorized procedure is agreed for
recording them in the exclusion tables.

## Automatic image synchronization

The automatic catalog synchronization currently has append-only image behavior:
it creates image rows whose product, variant, and URL key is missing, but does
not delete obsolete images or reconcile the order of existing rows. This policy
is preserved by this change. If the static catalog should become authoritative
for image deletion or ordering, decide that separately and add explicit
reconciliation tests before changing the behavior.

Administrative saves have different semantics: they compare the submitted
image URL sequence with the existing gallery and replace only that product's
or variant's gallery when the sequence changes.

## Stock

Automatic updates preserve existing product and variant stock. Initial creation
may use stock from the catalog source. Administrative product saves continue to
accept manual stock changes.
