export class SnapshotEngine {
  constructor() {
    this.snapshots = [];
    this.maxSnapshots = 5;
    this.comparisonMode = false;
    this.comparisonPair = null;
    this.nextId = 1;
  }

  saveSnapshot(name, config, renderer) {
    if (this.snapshots.length >= this.maxSnapshots) {
      return { success: false, message: `最多保存 ${this.maxSnapshots} 个快照` };
    }

    const cellMap = {};
    const allRows = renderer.allRows;
    const allColCombos = renderer.buildDataColumns();

    allRows.forEach(row => {
      allColCombos.forEach(col => {
        const value = renderer.getCellValue(row, col.colKeyObj, col.valueIndex);
        const key = `${row.key}\u0000${col.colKeyObj.key}\u0000${col.valueIndex}`;
        if (typeof value === 'number' && !isNaN(value)) {
          cellMap[key] = value;
        }
      });
    });

    const snapshot = {
      id: this.nextId++,
      name,
      createdAt: new Date(),
      config: JSON.parse(JSON.stringify(config)),
      cellMap
    };

    this.snapshots.push(snapshot);
    return { success: true, snapshot };
  }

  deleteSnapshot(id) {
    const idx = this.snapshots.findIndex(s => s.id === id);
    if (idx > -1) {
      this.snapshots.splice(idx, 1);
      if (this.comparisonMode && this.comparisonPair) {
        if (this.comparisonPair.left.id === id || this.comparisonPair.right.id === id) {
          this.exitComparison();
        }
      }
    }
  }

  renameSnapshot(id, newName) {
    const snapshot = this.snapshots.find(s => s.id === id);
    if (snapshot) {
      snapshot.name = newName;
    }
  }

  enterComparison(leftId, rightId) {
    const left = this.snapshots.find(s => s.id === leftId);
    const right = this.snapshots.find(s => s.id === rightId);
    if (!left || !right || leftId === rightId) return false;

    this.comparisonMode = true;
    this.comparisonPair = { left, right };
    return true;
  }

  exitComparison() {
    this.comparisonMode = false;
    this.comparisonPair = null;
  }

  getComparisonValues(rowKey, colKey, valueIndex) {
    if (!this.comparisonMode || !this.comparisonPair) return null;

    const key = `${rowKey}\u0000${colKey}\u0000${valueIndex}`;
    const leftRaw = this.comparisonPair.left.cellMap[key];
    const rightRaw = this.comparisonPair.right.cellMap[key];

    if (leftRaw === undefined && rightRaw === undefined) return null;

    const lv = leftRaw !== undefined ? leftRaw : null;
    const rv = rightRaw !== undefined ? rightRaw : null;

    const lvForDiff = lv !== null ? lv : 0;
    const rvForDiff = rv !== null ? rv : 0;

    const diff = rvForDiff - lvForDiff;
    let pctDiff = null;
    if (lvForDiff !== 0) {
      pctDiff = (diff / Math.abs(lvForDiff)) * 100;
    } else if (diff === 0) {
      pctDiff = 0;
    }

    return { leftVal: lv, rightVal: rv, diff, pctDiff };
  }

  getComparisonLabels() {
    if (!this.comparisonPair) return { left: 'A', right: 'B' };
    return {
      left: this.comparisonPair.left.name,
      right: this.comparisonPair.right.name
    };
  }
}
