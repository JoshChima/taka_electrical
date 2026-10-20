"""Build the fake InvenTree's fixtures from the demo seed, so tests use the seed's real numbers.

    python scripts/seed_fixtures.py ../seed/seed_electrical.py src/test/seed-fixtures.json

Runs the seed's data tables (everything above `def money`) with Django stubbed out, then writes
API-shaped rows (same field names as InvenTree 1.6.0 responses) with pks in creation order,
as a fresh database would assign them. Extend `rows()` when a ticket needs more endpoints.
"""

import json
import sys
from datetime import date, timedelta
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


# The seed dates orders from today; the fixtures use a fixed day so they regenerate identically.
FIXTURE_DAY = date(2026, 10, 19)


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

    cat_loc = {path: loc_pk[loc] for path, _desc, loc in t['CATEGORIES']}
    stock, part_details, supplier_parts = [], {}, {}
    for n, (ipn, cat, name, desc, units, cost, minimum, sup, _mfr, stock_spec, _params) in enumerate(t['PARTS']):
        # The seed copies the category's default location onto the part.
        part_detail = {'pk': n + 1, 'IPN': ipn, 'name': name, 'description': desc,
                       'units': units, 'minimum_stock': f'{minimum:.6f}',
                       'default_location': cat_loc[cat], 'category_default_location': cat_loc[cat]}
        part_details[ipn] = part_detail
        # One supplier part per part, created in part order. Wire comes in 500 ft reels, so its
        # purchase order quantities are in reels (packs), as in InvenTree.
        reel = units == 'ft'
        supplier_parts[ipn] = {'pk': n + 1, 'part': n + 1, 'supplier': list(t['SUPPLIERS']).index(sup) + 1,
                               'SKU': f"{t['SUPPLIERS'][sup][2]}-{10000 + n * 7}",
                               'pack_quantity': '500' if reel else '1',
                               'pack_quantity_native': 500.0 if reel else 1.0}
        for entry in stock_spec.split():
            loc, qty = entry.split(':')
            count, each = (int(qty), 1) if ipn in t['TRACKABLE'] else (1, float(qty))
            for _ in range(count):
                stock.append({'pk': len(stock) + 1, 'part': n + 1, 'quantity': each,
                              'location': loc_pk[loc], 'status': 10, 'in_stock': True,
                              'part_detail': part_detail})

    # Supplier pks follow SUPPLIERS (they are the first companies created); project codes follow PROJECTS.
    projects = [code for code, _ in t['PROJECTS']]
    status = {'PENDING': (10, 'Pending'), 'PLACED': (20, 'Placed')}
    purchase_orders, po_lines = [], []
    for ref, sup, prj, state, sup_ref, days, lines in t['PURCHASE_ORDERS']:
        code, text = status[state._mock_name]
        po = {'pk': len(purchase_orders) + 1, 'reference': ref,
              'supplier': list(t['SUPPLIERS']).index(sup) + 1, 'supplier_name': t['SUPPLIERS'][sup][0],
              'supplier_reference': sup_ref, 'status': code, 'status_text': text,
              'project_code': projects.index(prj) + 1 if prj else None, 'project_code_label': prj,
              'description': f'Material for {prj}' if prj else 'Warehouse restock',
              'target_date': (FIXTURE_DAY + timedelta(days=days)).isoformat(),
              'issue_date': FIXTURE_DAY.isoformat() if code == 20 else None,
              'destination': loc_pk['WH'], 'line_items': len(lines), 'completed_lines': 0}
        purchase_orders.append(po)
        for ipn, qty in lines:
            spart = supplier_parts[ipn]
            po_lines.append({'pk': len(po_lines) + 1, 'order': po['pk'], 'part': spart['pk'],
                             'quantity': float(qty), 'received': 0.0,
                             'project_code': po['project_code'], 'project_code_label': prj,
                             'destination': None, 'sku': spart['SKU'], 'ipn': ipn,
                             'internal_part': spart['part'], 'internal_part_name': part_details[ipn]['name'],
                             'part_detail': part_details[ipn], 'supplier_part_detail': spart})

    # Parts in creation order: the stocked parts, then the install kits (assemblies, no stock, min 0).
    parts = [{'pk': d['pk'], 'IPN': d['IPN'], 'name': d['name'], 'description': d['description'],
              'units': d['units'], 'minimum_stock': float(d['minimum_stock']), 'assembly': False, 'active': True}
             for d in part_details.values()]
    parts += [{'pk': len(parts) + n + 1, 'IPN': ipn, 'name': name, 'description': desc, 'units': '',
               'minimum_stock': 0.0, 'assembly': True, 'active': True}
              for n, (ipn, name, desc, _bom) in enumerate(t['KITS'])]
    project_codes = [{'pk': n + 1, 'code': code, 'description': desc, 'active': True}
                     for n, (code, desc) in enumerate(t['PROJECTS'])]
    return {'locations': locations, 'stock': stock, 'parts': parts, 'projectCodes': project_codes,
            'purchaseOrders': purchase_orders, 'poLines': po_lines}


if __name__ == '__main__':
    seed_path, out_path = sys.argv[1], sys.argv[2]
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rows(load_tables(seed_path)), f, indent=1)
        f.write('\n')
