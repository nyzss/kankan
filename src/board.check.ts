// Run: npx esbuild src/board.check.ts --bundle --platform=node | node   (silent = pass)
import { DEFAULT_BOARD, parse, serialize } from './board';

const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };

const md = `---
kankan: board
---

## Todo
- Fix login #work #urgent
  Users get logged out
  on refresh
- [ ] Buy plants #personal

## Archive %% collapsed %%
- Old thing
`;
const b = parse(md);
assert(b.columns.length === 2, 'columns');
assert(b.columns[1]!.collapsed && b.columns[1]!.name === 'Archive', 'collapsed');
const c = b.columns[0]!.cards[0]!;
assert(c.title === 'Fix login' && c.tags.join() === 'work,urgent', 'title/tags');
assert(c.desc === 'Users get logged out\non refresh', 'desc');
assert(b.columns[0]!.cards[1]!.title === 'Buy plants', 'checkbox items');
assert(JSON.stringify(parse(serialize(b))) === JSON.stringify(b), 'round trip');
assert(parse(DEFAULT_BOARD).columns.map((c) => c.name).join() === 'Backlog,Todo,In progress,Done,Archive', 'default');
