import { fields } from './data.js';
import { aggregationTypes } from './aggregator.js';

export class DrillDownEngine {
  constructor() {
    this.active = false;
    this.path = [];
    this.currentLevelData = null;
    this.cellContext = null;
    this.cellFilters = [];
    this.onStateChange = null;
    this._dimensionFields = fields.filter(f => f.type === 'dimension');
  }

  getDimensionFields() {
    return this._dimensionFields;
  }

  _getNextDimension(usedDimensions) {
    const usedKeys = new Set(usedDimensions);
    for (const field of this._dimensionFields) {
      if (!usedKeys.has(field.key)) {
        return field;
      }
    }
    return null;
  }

  startDrill(rawData, rowKeyObj, colKeyObj, valueIndex, pivotConfig) {
    this.active = true;
    this.rawData = rawData;
    this.cellContext = { rowKeyObj, colKeyObj, valueIndex, pivotConfig };

    this.cellFilters = [];
    if (rowKeyObj && !rowKeyObj.isTotal && rowKeyObj.values && rowKeyObj.values.length > 0) {
      pivotConfig.rows.forEach((dim, i) => {
        if (i < rowKeyObj.values.length) {
          this.cellFilters.push({ field: dim, value: rowKeyObj.values[i] });
        }
      });
    }
    if (colKeyObj && !colKeyObj.isTotal && colKeyObj.values && colKeyObj.values.length > 0) {
      pivotConfig.columns.forEach((dim, i) => {
        if (i < colKeyObj.values.length) {
          this.cellFilters.push({ field: dim, value: colKeyObj.values[i] });
        }
      });
    }

    this.path = [];
    this._computeInitialData();
    this._notify();
  }

  _computeInitialData() {
    const { valueIndex, pivotConfig } = this.cellContext;
    const baseFiltered = this._getBaseFilteredData();
    const valueField = pivotConfig.values[valueIndex];
    if (!valueField) return;

    const usedDimensions = this._getUsedDimensions();
    const nextDim = this._getNextDimension(usedDimensions);

    if (!nextDim) {
      this.currentLevelData = { items: [], dimension: null, totalValue: 0, hasMore: false };
      return;
    }

    const { items, totalValue } = this._computeBreakdown(baseFiltered, nextDim.key, valueField);
    this.currentLevelData = {
      items,
      dimension: nextDim,
      totalValue,
      hasMore: this._hasMoreDimensions([...usedDimensions, nextDim.key])
    };
  }

  _getBaseFilteredData() {
    const { pivotConfig } = this.cellContext;
    const { filters } = pivotConfig;

    let data = this.rawData;

    if (filters && filters.length > 0) {
      data = data.filter(record => {
        return filters.every(filter => {
          if (!filter.values || filter.values.length === 0) return true;
          return filter.values.includes(record[filter.field]);
        });
      });
    }

    for (const cf of this.cellFilters) {
      data = data.filter(record => record[cf.field] === cf.value);
    }

    for (const step of this.path) {
      data = data.filter(record => record[step.dimension] === step.value);
    }

    return data;
  }

  _computeBreakdown(data, dimensionKey, valueConfig) {
    const groups = {};
    data.forEach(record => {
      const key = record[dimensionKey];
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(record);
    });

    const items = [];
    let totalValue = 0;

    Object.keys(groups).sort().forEach(key => {
      const records = groups[key];
      let value;
      if (valueConfig.isCalculated) {
        value = 0;
      } else {
        const fieldValues = records.map(r => r[valueConfig.field]);
        value = aggregationTypes[valueConfig.aggregation].fn(fieldValues);
      }
      items.push({ label: key, value, count: records.length });
      totalValue += value;
    });

    items.forEach(item => {
      item.percent = totalValue !== 0 ? (item.value / totalValue * 100) : 0;
    });

    items.sort((a, b) => b.value - a.value);

    return { items, totalValue };
  }

  _hasMoreDimensions(usedDimensions) {
    return this._getNextDimension(usedDimensions) !== null;
  }

  _getUsedDimensions() {
    const { pivotConfig } = this.cellContext;
    const usedInPivot = [
      ...(pivotConfig.rows || []),
      ...(pivotConfig.columns || [])
    ];
    const usedInPath = this.path.map(step => step.dimension);
    return [...usedInPivot, ...usedInPath];
  }

  drillDeeper(dimensionValue) {
    const usedDimensions = this._getUsedDimensions();
    const currentDim = this._getNextDimension(usedDimensions);
    if (!currentDim) return;

    this.path.push({ dimension: currentDim.key, value: dimensionValue, label: currentDim.label });

    const baseFiltered = this._getBaseFilteredData();
    const { valueIndex, pivotConfig } = this.cellContext;
    const valueField = pivotConfig.values[valueIndex];
    const newUsedDimensions = this._getUsedDimensions();
    const nextDim = this._getNextDimension(newUsedDimensions);

    if (!nextDim) {
      this.currentLevelData = { items: [], dimension: null, totalValue: 0, hasMore: false };
      this._notify();
      return;
    }

    const { items, totalValue } = this._computeBreakdown(baseFiltered, nextDim.key, valueField);
    this.currentLevelData = {
      items,
      dimension: nextDim,
      totalValue,
      hasMore: this._hasMoreDimensions([...newUsedDimensions, nextDim.key])
    };
    this._notify();
  }

  navigateTo(levelIndex) {
    if (levelIndex < 0) {
      this.path = [];
      this._computeInitialData();
      this._notify();
      return;
    }
    if (levelIndex >= this.path.length) return;

    this.path = this.path.slice(0, levelIndex + 1);
    this._recomputeCurrentLevel();
  }

  _recomputeCurrentLevel() {
    const baseFiltered = this._getBaseFilteredData();
    const { valueIndex, pivotConfig } = this.cellContext;
    const valueField = pivotConfig.values[valueIndex];
    const usedDimensions = this._getUsedDimensions();
    const nextDim = this._getNextDimension(usedDimensions);

    if (!nextDim) {
      this.currentLevelData = { items: [], dimension: null, totalValue: 0, hasMore: false };
      this._notify();
      return;
    }

    const { items, totalValue } = this._computeBreakdown(baseFiltered, nextDim.key, valueField);
    this.currentLevelData = {
      items,
      dimension: nextDim,
      totalValue,
      hasMore: this._hasMoreDimensions([...usedDimensions, nextDim.key])
    };
    this._notify();
  }

  close() {
    this.active = false;
    this.path = [];
    this.currentLevelData = null;
    this.cellContext = null;
    this.cellFilters = [];
    this._notify();
  }

  validatePath(rawData, pivotConfig) {
    if (!this.active) return;

    this.rawData = rawData;
    this.cellContext.pivotConfig = pivotConfig;

    const usedInPivot = new Set([
      ...(pivotConfig.rows || []),
      ...(pivotConfig.columns || [])
    ]);

    const newPath = [];

    for (let i = 0; i < this.path.length; i++) {
      const step = this.path[i];

      if (usedInPivot.has(step.dimension)) {
        break;
      }

      const baseFiltered = this._getBaseFilteredDataForPath(newPath);
      const validValues = new Set(baseFiltered.map(r => r[step.dimension]));
      if (!validValues.has(step.value)) {
        break;
      }

      newPath.push(step);
    }

    this.path = newPath;
    this._recomputeCurrentLevel();
  }

  _getBaseFilteredDataForPath(pathSteps) {
    const { pivotConfig } = this.cellContext;
    const { filters } = pivotConfig;

    let data = this.rawData;

    if (filters && filters.length > 0) {
      data = data.filter(record => {
        return filters.every(filter => {
          if (!filter.values || filter.values.length === 0) return true;
          return filter.values.includes(record[filter.field]);
        });
      });
    }

    for (const cf of this.cellFilters) {
      data = data.filter(record => record[cf.field] === cf.value);
    }

    for (const step of pathSteps) {
      data = data.filter(record => record[step.dimension] === step.value);
    }

    return data;
  }

  getBreadcrumbPath() {
    const crumbs = [{ label: '总计', level: -1 }];
    this.path.forEach((step, idx) => {
      const dimField = this._dimensionFields.find(f => f.key === step.dimension);
      crumbs.push({
        label: step.value,
        dimension: dimField ? dimField.label : step.dimension,
        level: idx
      });
    });
    return crumbs;
  }

  _notify() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  getState() {
    return {
      active: this.active,
      path: [...this.path],
      currentLevelData: this.currentLevelData,
      breadcrumb: this.getBreadcrumbPath(),
      cellContext: this.cellContext
    };
  }
}
