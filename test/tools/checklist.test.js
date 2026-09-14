const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 人工验收清单的自洽性。
 *
 * 清单顶部有两张表：哪些已经自动化、哪些仍然只能人工。它们是**声称**——
 * 声称覆盖了却没覆盖，比不声称更糟，因为读者会把时间省下来却漏掉真正的检查。
 *
 * 这里守的是最基本的一致性：正文里每一条都必须出现在其中一张表里，
 * 表里也不能出现正文没有的编号。至于"声称自动化的是否真有对应断言"，
 * 那要靠读 test/ui/ 才能确认，静态检查做不到。
 */

const checklistPath = path.join(__dirname, '..', '..', 'docs', 'testing', 'electron-windows-manual-checklist.md');
const document = fs.readFileSync(checklistPath, 'utf8');

/** 正文表格里每一项的编号，例如 `| 4.1 |`。 */
function itemIds() {
  return [...document.matchAll(/^\| (\d+\.\d+) \|/gm)].map((match) => match[1]);
}

/**
 * 取出某一节里的表格文本。
 *
 * **必须限定在分类表里扫编号。** 第一版没限定，于是在整份文档里找"只含编号的单元格"，
 * 结果正文每一行自己的编号列就被算成了"已分类"——守卫永远通过，等于没写。
 * 是探针（故意插一条未分类的项）把这个漏洞照出来的。
 */
function sectionStartingWith(headerCell) {
  const start = document.indexOf(`| ${headerCell} |`);
  if (start < 0) return '';
  const rest = document.slice(start);
  const end = rest.search(/\r?\n\s*\r?\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

const classificationTables = [
  sectionStartingWith('已自动覆盖'),
  sectionStartingWith('为什么做不到')
].join('\n');

test('两张分类表都真的被取到了', () => {
  assert.ok(classificationTables.includes('已自动覆盖'), '找不到「已自动覆盖」表');
  assert.ok(classificationTables.includes('为什么做不到'), '找不到「仍然只能人工」表');
});

/** 分类表里提到的编号，`3.1–3.4` 这种区间展开成逐个。 */
function classifiedIds() {
  const ids = new Set();
  for (const match of classificationTables.matchAll(/\| ((?:\d+\.\d+(?:–\d+\.\d+)?[、，]?\s*)+) \|/g)) {
    for (const token of match[1].split(/[、，]/)) {
      const trimmed = token.trim();
      const range = trimmed.match(/^(\d+)\.(\d+)–(\d+)\.(\d+)$/);
      if (range) {
        for (let index = Number(range[2]); index <= Number(range[4]); index += 1) {
          ids.add(`${range[1]}.${index}`);
        }
      } else if (/^\d+\.\d+$/.test(trimmed)) {
        ids.add(trimmed);
      }
    }
  }
  return ids;
}

test('验收清单里每一项都被分类过（自动化 或 人工）', () => {
  const ids = itemIds();
  assert.ok(ids.length > 60, `清单条目看起来太少了：${ids.length}`);

  const classified = classifiedIds();
  const unclassified = ids.filter((id) => !classified.has(id));
  assert.deepEqual(
    unclassified,
    [],
    `这些条目没有出现在「已自动覆盖」或「仍然只能人工」表里：${unclassified.join('、')}`
  );
});

test('验收清单里的编号不重复', () => {
  const ids = itemIds();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `重复编号：${[...new Set(duplicates)].join('、')}`);
});

test('分类表里不出现正文没有的编号', () => {
  const ids = new Set(itemIds());
  const orphans = [...classifiedIds()].filter((id) => !ids.has(id)).sort();
  assert.deepEqual(orphans, [], `分类表提到了正文里没有的编号：${orphans.join('、')}`);
});

test('清单写明了怎么跑自动化部分', () => {
  assert.match(document, /npm run ui-check/);
  assert.match(document, /npm run verify:win/);
});
