/*
 * 五套主题：切换真的生效、选中态跟着走、每套主题的文字仍然达标。
 *
 * 只断言能算出来的东西：主题挂载点、选中状态、文字对比度。
 * 「好不好看」不在自动断言范围内。
 */

const parseColor = (value) => {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
};

const toLinear = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (color) =>
  0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);

const contrastRatio = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const composite = (foreground, background) => ({
  r: foreground.r * foreground.a + background.r * (1 - foreground.a),
  g: foreground.g * foreground.a + background.g * (1 - foreground.a),
  b: foreground.b * foreground.a + background.b * (1 - foreground.a),
  a: 1
});

function worstContrast(element) {
  const surface = parseColor(getComputedStyle(q('.app-shell'), '::before').backgroundColor);
  const text = parseColor(getComputedStyle(element).color);
  if (!surface || !text) return null;
  const ratios = [255, 0].map((wall) => {
    const background = composite(surface, { r: wall, g: wall, b: wall, a: 1 });
    return contrastRatio(composite(text, background), background);
  });
  return Math.min(...ratios);
}

const THEMES = ['glass', 'pixel', 'cyber', 'ink', 'frost'];

for (const theme of THEMES) {
  applyTheme(theme);
  await sleep(30);

  check(`主题 ${theme} 挂到了 html`, document.documentElement.dataset.theme === theme,
    document.documentElement.dataset.theme);

  const swatch = qa('.theme-swatch').find((item) => item.dataset.theme === theme);
  check(`主题 ${theme} 的选择器有选中态`, Boolean(swatch) && swatch.classList.contains('is-active') &&
    swatch.getAttribute('aria-checked') === 'true');

  const bodyRow = q('.todo-text');
  const bodyContrast = bodyRow ? worstContrast(bodyRow) : null;
  check(`主题 ${theme} 的任务文字达到 AA`, bodyContrast !== null && bodyContrast >= 4.5,
    bodyContrast === null ? null : `${bodyContrast.toFixed(2)}:1`);

  const muted = q('.progress-label');
  const mutedContrast = muted ? worstContrast(muted) : null;
  check(`主题 ${theme} 的次要文字达到 AA`, mutedContrast !== null && mutedContrast >= 4.5,
    mutedContrast === null ? null : `${mutedContrast.toFixed(2)}:1`);
}

// 切回默认，避免后续场景截图带着随机主题。
applyTheme('glass');
await sleep(30);
check('切回玻璃主题', document.documentElement.dataset.theme === 'glass');

return results;
