export function moveCategoryInOrder(rows, categoryId, direction) {
    const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const currentIndex = ordered.findIndex((row) => row.id === categoryId);
    if (currentIndex < 0) {
        return { rows: ordered, moved: false, boundary: false, notFound: true };
    }
    const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= ordered.length) {
        return { rows: ordered, moved: false, boundary: true };
    }
    const [current] = ordered.splice(currentIndex, 1);
    ordered.splice(targetIndex, 0, current);
    return {
        rows: ordered.map((row, index) => ({ ...row, sortOrder: index })),
        moved: true,
        boundary: false,
    };
}
