export const aggregationTypes = {
  sum: { label: '求和', fn: (values) => values.reduce((a, b) => a + b, 0) },
  count: { label: '计数', fn: (values) => values.length },
  avg: { label: '平均值', fn: (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0 },
  max: { label: '最大值', fn: (values) => values.length ? Math.max(...values) : 0 },
  min: { label: '最小值', fn: (values) => values.length ? Math.min(...values) : 0 }
};

export function aggregateData(data, config) {
  const { rows, columns, values, filters } = config;
  
  let filteredData = applyFilters(data, filters);
  
  const rowKeys = generateKeys(filteredData, rows);
  const columnKeys = generateKeys(filteredData, columns);
  
  const result = {
    rowKeys,
    columnKeys,
    values: [],
    data: {}
  };
  
  values.forEach((valueConfig, valueIndex) => {
    result.values.push({
      field: valueConfig.field,
      aggregation: valueConfig.aggregation,
      label: `${aggregationTypes[valueConfig.aggregation].label}(${valueConfig.field})`
    });
  });
  
  rowKeys.forEach(rowKey => {
    columnKeys.forEach(colKey => {
      const cellKey = `${rowKey.key}||${colKey.key}`;
      const cellData = getCellData(filteredData, rows, columns, rowKey, colKey);
      
      result.data[cellKey] = [];
      values.forEach(valueConfig => {
        const fieldValues = cellData.map(d => d[valueConfig.field]);
        const aggregatedValue = aggregationTypes[valueConfig.aggregation].fn(fieldValues);
        result.data[cellKey].push(aggregatedValue);
      });
    });
  });
  
  return result;
}

function applyFilters(data, filters) {
  if (!filters || filters.length === 0) return data;
  
  return data.filter(record => {
    return filters.every(filter => {
      if (!filter.values || filter.values.length === 0) return true;
      return filter.values.includes(record[filter.field]);
    });
  });
}

function generateKeys(data, dimensions) {
  if (!dimensions || dimensions.length === 0) {
    return [{ key: '__total__', values: [], isTotal: true }];
  }
  
  const keySet = new Set();
  const keys = [];
  
  data.forEach(record => {
    const values = dimensions.map(dim => record[dim]);
    const keyStr = values.join('||');
    
    if (!keySet.has(keyStr)) {
      keySet.add(keyStr);
      keys.push({ key: keyStr, values, isTotal: false });
    }
  });
  
  keys.sort((a, b) => {
    for (let i = 0; i < a.values.length; i++) {
      if (a.values[i] < b.values[i]) return -1;
      if (a.values[i] > b.values[i]) return 1;
    }
    return 0;
  });
  
  return keys;
}

function getCellData(data, rowDims, colDims, rowKey, colKey) {
  return data.filter(record => {
    const rowMatch = rowKey.isTotal || rowDims.every((dim, i) => record[dim] === rowKey.values[i]);
    const colMatch = colKey.isTotal || colDims.every((dim, i) => record[dim] === colKey.values[i]);
    return rowMatch && colMatch;
  });
}

export function getDistinctValues(data, field) {
  const values = new Set();
  data.forEach(record => values.add(record[field]));
  return Array.from(values).sort();
}

export function getDetailRecords(data, config, rowKey, colKey) {
  const { rows, columns, filters } = config;
  let filteredData = applyFilters(data, filters);
  
  return filteredData.filter(record => {
    const rowMatch = !rowKey || rowKey.isTotal || rows.every((dim, i) => record[dim] === rowKey.values[i]);
    const colMatch = !colKey || colKey.isTotal || columns.every((dim, i) => record[dim] === colKey.values[i]);
    return rowMatch && colMatch;
  });
}

export function buildRowHierarchy(rowKeys, rows) {
  if (!rows || rows.length === 0) {
    return [{ level: 0, key: '__total__', label: '总计', values: [], isTotal: true, children: [], expanded: true }];
  }
  
  const root = [];
  const map = new Map();
  
  rowKeys.forEach(rowKey => {
    let currentLevel = root;
    let parentKey = '';
    
    for (let level = 0; level < rowKey.values.length; level++) {
      const value = rowKey.values[level];
      const key = rowKey.values.slice(0, level + 1).join('||');
      
      if (!map.has(key)) {
        const node = {
          level,
          key,
          label: value,
          values: rowKey.values.slice(0, level + 1),
          isTotal: false,
          children: [],
          expanded: true,
          hasChildren: level < rows.length - 1
        };
        
        map.set(key, node);
        currentLevel.push(node);
      }
      
      currentLevel = map.get(key).children;
      parentKey = key;
    }
  });
  
  return root;
}
