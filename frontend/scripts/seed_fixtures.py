"""Build the fake InvenTree's fixtures from the demo seed, so tests use the seed's real numbers.

    python scripts/seed_fixtures.py ../seed/seed_electrical.py src/test/seed-fixtures.json

Runs the seed's data tables (everything above `def money`) with Django stubbed out, then writes
API-shaped rows (same field names as InvenTree 1.6.0 responses) with pks in creation order,
as a fresh database would assign them. Extend `rows()` when a ticket needs more endpoints.
"""

import json
import sys
from types import ModuleType
from unittest.mock import MagicMock


class Stub(ModuleType):
    def __getattr__(self, name):
        return MagicMock(name=name)


def load_tables(seed_path):
    source = open(seed_path, encoding='utf-8').read()
    sys.meta_path.insert(0, StubFinder())
    tables = {}
    exec(source.split('\ndef money(')[0], tables)
    return tables


class StubFinder:
    roots = ('django', 'build', 'common', 'company', 'order', 'part', 'stock')

    def find_spec(self, fullname, path=None, target=None):
        from importlib.machinery import ModuleSpec
        if fullname.split('.')[0] in self.roots:
            return ModuleSpec(fullname, self, is_package=True)
        return None

    def create_module(self, spec):
        return Stub(spec.name)

    def exec_module(self, module):
        module.__path__ = []


def rows(t):
    locations, by_path = [], {}
    for key, (path, description, structural) in t['LOCATIONS'].items():
        parts = path.split('/')
        for depth in range(len(parts)):
            sub = '/'.join(parts[:depth + 1])
            if sub not in by_path:
                row = {'pk': len(locations) + 1, 'name': parts[depth], 'description': '',
                       'parent': by_path['/'.join(parts[:depth])]['pk'] if depth else None,
                       'pathstring': sub, 'level': depth, 'structural': False}
                locations.append(row)
                by_path[sub] = row
        by_path[path].update(description=description, structural=structural)
    loc_pk = {key: by_path[path]['pk'] for key, (path, _, _) in t['LOCATIONS'].items()}

    stock = []
    for n, (ipn, _cat, name, desc, units, _cost, minimum, *_rest) in enumerate(t['PARTS']):
        stock_spec = _rest[2]
        part_detail = {'pk': n + 1, 'IPN': ipn, 'name': name, 'description': desc,
                       'units': units, 'minimum_stock': f'{minimum:.6f}'}
        for entry in stock_spec.split():
            loc, qty = entry.split(':')
            count, each = (int(qty), 1) if ipn in t['TRACKABLE'] else (1, float(qty))
            for _ in range(count):
                stock.append({'pk': len(stock) + 1, 'part': n + 1, 'quantity': each,
                              'location': loc_pk[loc], 'status': 10, 'in_stock': True,
                              'part_detail': part_detail})
    return {'locations': locations, 'stock': stock}


if __name__ == '__main__':
    seed_path, out_path = sys.argv[1], sys.argv[2]
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rows(load_tables(seed_path)), f, indent=1)
        f.write('\n')
