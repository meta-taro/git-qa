import { renderColumns } from './render.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  // 握り潰さない（product-baseline §8）。index.html と食い違ったら起動時に分かるようにする。
  throw new Error('#app が index.html に無い');
}

renderColumns(root);
