"""Taka Electrical demo dataset for InvenTree.

Run inside the InvenTree container (the `inventree-seed` compose service does this):
    cd src/backend/InvenTree && python manage.py shell < /home/inventree/seed/seed_electrical.py

Idempotent: if the dataset is already present it exits without changes.
Everything is created in one transaction, so a failure leaves the database untouched.
All companies, people and addresses are fictional.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from build.models import Build
from build.status_codes import BuildStatus
from common.models import Parameter, ParameterTemplate, ProjectCode
from common.settings import set_global_setting
from company.models import Address, Company, Contact, ManufacturerPart, SupplierPart, SupplierPriceBreak
from order.models import PurchaseOrder, PurchaseOrderLineItem, SalesOrder, SalesOrderLineItem
from order.status_codes import PurchaseOrderStatus, SalesOrderStatus
from part.models import BomItem, Part, PartCategory
from stock.models import StockItem, StockLocation

MARKER_IPN = 'KIT-SVC-200'
TODAY = date.today()

# --- Settings ---------------------------------------------------------------
SETTINGS = {
    'INVENTREE_COMPANY_NAME': 'Taka Electrical',
    'INVENTREE_INSTANCE': 'Taka Electrical Inventory',
    'PROJECT_CODES_ENABLED': True,
}

# --- Projects ---------------------------------------------------------------
PROJECTS = [
    ('PRJ-101', 'Alvarez Residence - 200A service upgrade & kitchen remodel'),
    ('PRJ-102', 'Riverside Medical Group - Suite 300 tenant improvement (12 offices)'),
    ('PRJ-103', 'Harbor Point Logistics - warehouse LED high-bay retrofit (40 fixtures)'),
    ('PRJ-104', 'Oakview Apartments - parking garage EV charging (8 stations)'),
]

# --- Stock locations (path, description, structural) -------------------------
LOCATIONS = {
    'WH': ('Main Warehouse', 'Taka Electrical shop & warehouse', True),
    'A': ('Main Warehouse/Aisle A - Wire & Cable', 'Reel racks and cable', False),
    'B': ('Main Warehouse/Aisle B - Conduit & Fittings', 'Conduit racks, fitting bins', False),
    'C': ('Main Warehouse/Aisle C - Boxes & Devices', 'Boxes, receptacles, switches, plates', False),
    'D': ('Main Warehouse/Aisle D - Breakers & Panels', 'Gear, breakers, disconnects', False),
    'E': ('Main Warehouse/Aisle E - Lighting & EV', 'Fixtures and EV equipment', False),
    'F': ('Main Warehouse/Aisle F - Supports & Consumables', 'Strut, rod, anchors, tape', False),
    'CRIB': ('Main Warehouse/Tool Crib', 'Checked-out tools and meters', False),
    'VANS': ('Service Vans', 'Truck stock', True),
    'V1': ('Service Vans/Van 01 (Residential)', 'Residential crew truck stock', False),
    'V2': ('Service Vans/Van 02 (Commercial)', 'Commercial crew truck stock', False),
    'V3': ('Service Vans/Van 03 (Service Calls)', 'Service technician truck stock', False),
    'JOBS': ('Job Sites', 'Material staged at active job sites', True),
    'J101': ('Job Sites/PRJ-101 Alvarez Residence', '418 Maple St', False),
    'J102': ('Job Sites/PRJ-102 Riverside Medical Suite 300', '2200 Riverside Dr, Suite 300', False),
    'J103': ('Job Sites/PRJ-103 Harbor Point Warehouse', '75 Harbor Point Rd, Bldg C', False),
    'J104': ('Job Sites/PRJ-104 Oakview Apartments Garage', '901 Oakview Blvd, Level P1', False),
}

# --- Part categories (path, description, default location key) --------------
CATEGORIES = [
    ('Wire & Cable', 'Conductors and cable assemblies', 'A'),
    ('Wire & Cable/Building Wire', 'THHN/THWN-2 single conductors', 'A'),
    ('Wire & Cable/NM-B Cable', 'Non-metallic sheathed cable (Romex type)', 'A'),
    ('Wire & Cable/MC Cable', 'Metal-clad armored cable', 'A'),
    ('Wire & Cable/Service Entrance', 'SER/SEU service entrance cable', 'A'),
    ('Wire & Cable/Low Voltage', 'Data, thermostat and control cable', 'A'),
    ('Conduit & Raceway', 'Raceway systems', 'B'),
    ('Conduit & Raceway/EMT', 'Electrical metallic tubing, 10 ft sticks', 'B'),
    ('Conduit & Raceway/PVC', 'Schedule 40 PVC conduit, 10 ft sticks', 'B'),
    ('Conduit & Raceway/Fittings', 'Connectors, couplings, straps, conduit bodies', 'B'),
    ('Boxes & Enclosures', 'Device, junction and ceiling boxes', 'C'),
    ('Wiring Devices', 'Receptacles, switches and plates', 'C'),
    ('Wiring Devices/Receptacles', '', 'C'),
    ('Wiring Devices/Switches & Controls', '', 'C'),
    ('Wiring Devices/Wall Plates', '', 'C'),
    ('Circuit Protection', 'Overcurrent protection and distribution', 'D'),
    ('Circuit Protection/Circuit Breakers', 'Plug-on residential/light commercial breakers', 'D'),
    ('Circuit Protection/Panels & Meter Sockets', '', 'D'),
    ('Circuit Protection/Disconnects', '', 'D'),
    ('Grounding & Bonding', 'Grounding electrodes and clamps', 'D'),
    ('Lighting', 'Luminaires', 'E'),
    ('Lighting/LED Fixtures', '', 'E'),
    ('Lighting/Emergency & Exit', '', 'E'),
    ('EV Charging', 'Electric vehicle supply equipment', 'E'),
    ('Connectors & Terminals', 'Splicing and termination', 'F'),
    ('Supports & Fasteners', 'Hangers, rod, clamps, anchors', 'F'),
    ('Consumables', 'Tape, lubricant and shop supplies', 'F'),
    ('Tools & Equipment', 'Company-owned tools and test equipment', 'CRIB'),
    ('Install Kits', 'Pre-staged material kits built for jobs', 'WH'),
]

# --- Companies ----------------------------------------------------------------
SUPPLIERS = {
    'NG': ('Northgate Electrical Supply', 'Full-line electrical distributor - gear, devices, conduit', 'NES'),
    'RW': ('Ridgeline Wire & Cable', 'Wire and cable specialist - cut reels to length', 'RWC'),
    'BP': ('BrightPath Lighting Distributors', 'Commercial lighting and controls distributor', 'BPL'),
}
MANUFACTURERS = {
    'CW': ('Copperline Wire Co.', 'CL'),
    'IR': ('Ironclad Raceway', 'IRW'),
    'AD': ('Ampere Devices', 'AMP'),
    'KC': ('Keystone Circuit Protection', 'KCP'),
    'LW': ('Lumenworks Lighting', 'LUX'),
    'CC': ('ChargeCore EV', 'CCE'),
    'FS': ('Fastline Supports', 'FST'),
    'PV': ('ProVolt Tools', 'PVT'),
}
CUSTOMERS = {
    'ALV': ('Alvarez Residence', 'Residential remodel customer', 'Maria Alvarez', 'Homeowner',
            '418 Maple St', 'Springfield', 'IL', '62704'),
    'RMG': ('Riverside Medical Group', 'Multi-site outpatient clinic group', 'Dana Whitfield', 'Facilities Manager',
            '2200 Riverside Dr', 'Springfield', 'IL', '62702'),
    'HPL': ('Harbor Point Logistics', 'Regional 3PL distribution center', 'Marcus Lee', 'Plant Engineer',
            '75 Harbor Point Rd', 'Springfield', 'IL', '62707'),
    'OAK': ('Oakview Apartments HOA', '120-unit residential community', 'Priya Natarajan', 'Property Manager',
            '901 Oakview Blvd', 'Springfield', 'IL', '62711'),
}

# --- Parameter templates (name: (units, description, choices)) ----------------
TEMPLATES = {
    'Gauge': ('', 'Conductor size (AWG / kcmil)', ''),
    'Conductor': ('', 'Conductor material', 'Copper,Aluminum'),
    'Color': ('', 'Insulation / finish color', ''),
    'Voltage Rating': ('V', 'Maximum rated voltage', ''),
    'Current Rating': ('A', 'Rated current', ''),
    'Poles': ('', 'Number of poles', ''),
    'Trade Size': ('', 'Conduit trade size', ''),
    'Power': ('W', 'Input power', ''),
    'Light Output': ('lm', 'Delivered lumens', ''),
    'Color Temperature': ('K', 'Correlated color temperature', ''),
}

# --- Parts ----------------------------------------------------------------------
# (IPN, category, name, description, units, unit cost USD, min stock, supplier, manufacturer,
#  stock "LOC:qty ...", parameters "Name=value;...")
PARTS = [
    # Building wire (sold per foot, stocked on reels)
    ('WIR-THHN-12-BLK', 'Wire & Cable/Building Wire', 'THHN 12 AWG Black', 'THHN/THWN-2 12 AWG stranded copper, black', 'ft', 0.22, 1000, 'RW', 'CW',
     'A:2500 V1:500 V2:500', 'Gauge=12 AWG;Conductor=Copper;Color=Black;Voltage Rating=600'),
    ('WIR-THHN-12-WHT', 'Wire & Cable/Building Wire', 'THHN 12 AWG White', 'THHN/THWN-2 12 AWG stranded copper, white', 'ft', 0.22, 1000, 'RW', 'CW',
     'A:2000 V1:500 V2:500', 'Gauge=12 AWG;Conductor=Copper;Color=White;Voltage Rating=600'),
    ('WIR-THHN-12-GRN', 'Wire & Cable/Building Wire', 'THHN 12 AWG Green', 'THHN/THWN-2 12 AWG stranded copper, green', 'ft', 0.22, 1000, 'RW', 'CW',
     'A:1500 V2:500', 'Gauge=12 AWG;Conductor=Copper;Color=Green;Voltage Rating=600'),
    ('WIR-THHN-10-BLK', 'Wire & Cable/Building Wire', 'THHN 10 AWG Black', 'THHN/THWN-2 10 AWG stranded copper, black', 'ft', 0.36, 500, 'RW', 'CW',
     'A:1000 V2:250', 'Gauge=10 AWG;Conductor=Copper;Color=Black;Voltage Rating=600'),
    ('WIR-THHN-6-BLK', 'Wire & Cable/Building Wire', 'THHN 6 AWG Black', 'THHN/THWN-2 6 AWG stranded copper, black', 'ft', 1.05, 500, 'RW', 'CW',
     'A:600', 'Gauge=6 AWG;Conductor=Copper;Color=Black;Voltage Rating=600'),
    ('WIR-THHN-6-RED', 'Wire & Cable/Building Wire', 'THHN 6 AWG Red', 'THHN/THWN-2 6 AWG stranded copper, red', 'ft', 1.05, 500, 'RW', 'CW',
     'A:500', 'Gauge=6 AWG;Conductor=Copper;Color=Red;Voltage Rating=600'),
    ('WIR-THHN-8-GRN', 'Wire & Cable/Building Wire', 'THHN 8 AWG Green', 'THHN/THWN-2 8 AWG stranded copper, green (EGC)', 'ft', 0.62, 500, 'RW', 'CW',
     'A:500', 'Gauge=8 AWG;Conductor=Copper;Color=Green;Voltage Rating=600'),
    ('WIR-BARE-4', 'Wire & Cable/Building Wire', 'Bare Copper 4 AWG Solid', 'Bare solid soft-drawn copper, grounding electrode conductor', 'ft', 1.45, 200, 'RW', 'CW',
     'A:300 J101:30', 'Gauge=4 AWG;Conductor=Copper'),
    # NM-B
    ('WIR-NMB-14-2', 'Wire & Cable/NM-B Cable', 'NM-B 14/2 w/G', 'Non-metallic sheathed cable 14/2 with ground, 250 ft coil', 'ft', 0.45, 1000, 'RW', 'CW',
     'A:1500 V1:250', 'Gauge=14 AWG;Conductor=Copper;Voltage Rating=600'),
    ('WIR-NMB-12-2', 'Wire & Cable/NM-B Cable', 'NM-B 12/2 w/G', 'Non-metallic sheathed cable 12/2 with ground, 250 ft coil', 'ft', 0.68, 1000, 'RW', 'CW',
     'A:2000 V1:500', 'Gauge=12 AWG;Conductor=Copper;Voltage Rating=600'),
    ('WIR-NMB-12-3', 'Wire & Cable/NM-B Cable', 'NM-B 12/3 w/G', 'Non-metallic sheathed cable 12/3 with ground, 250 ft coil', 'ft', 0.98, 500, 'RW', 'CW',
     'A:750 V1:250', 'Gauge=12 AWG;Conductor=Copper;Voltage Rating=600'),
    ('WIR-NMB-6-3', 'Wire & Cable/NM-B Cable', 'NM-B 6/3 w/G', 'Non-metallic sheathed cable 6/3 with ground - ranges, ovens', 'ft', 3.10, 100, 'RW', 'CW',
     'A:250', 'Gauge=6 AWG;Conductor=Copper;Voltage Rating=600'),
    # MC / SER / low voltage
    ('WIR-MC-12-2', 'Wire & Cable/MC Cable', 'MC 12/2 Aluminum Armor', 'Metal-clad cable 12/2 + insulated ground, aluminum armor, 250 ft coil', 'ft', 0.85, 2000, 'RW', 'CW',
     'A:2500 V2:250', 'Gauge=12 AWG;Conductor=Copper;Voltage Rating=600'),
    ('WIR-MC-12-3', 'Wire & Cable/MC Cable', 'MC 12/3 Aluminum Armor', 'Metal-clad cable 12/3 + insulated ground, aluminum armor, 250 ft coil', 'ft', 1.15, 500, 'RW', 'CW',
     'A:1000', 'Gauge=12 AWG;Conductor=Copper;Voltage Rating=600'),
    ('WIR-SER-4/0', 'Wire & Cable/Service Entrance', 'SER 4/0-4/0-4/0-2/0 Aluminum', 'Service entrance cable, Style R, aluminum, 4/0-4/0-4/0-2/0', 'ft', 4.25, 100, 'RW', 'CW',
     'A:150 J101:25', 'Gauge=4/0 AWG;Conductor=Aluminum;Voltage Rating=600'),
    ('WIR-CAT6-BLU', 'Wire & Cable/Low Voltage', 'Cat6 UTP Plenum Blue', 'Category 6 23 AWG 4-pair UTP, CMP plenum rated, 1000 ft box', 'ft', 0.32, 1000, 'RW', 'CW',
     'A:3000', 'Gauge=23 AWG;Conductor=Copper;Color=Blue'),
    ('WIR-TSTAT-18-5', 'Wire & Cable/Low Voltage', 'Thermostat Wire 18/5', '18 AWG 5-conductor solid copper thermostat cable, 250 ft', 'ft', 0.28, 250, 'RW', 'CW',
     'A:500 V3:250', 'Gauge=18 AWG;Conductor=Copper'),
    # Conduit
    ('CND-EMT-050', 'Conduit & Raceway/EMT', '1/2" EMT Conduit, 10 ft', 'Electrical metallic tubing, 1/2" trade size, 10 ft stick', '', 6.85, 100, 'NG', 'IR',
     'B:120 V2:10', 'Trade Size=1/2 in'),
    ('CND-EMT-075', 'Conduit & Raceway/EMT', '3/4" EMT Conduit, 10 ft', 'Electrical metallic tubing, 3/4" trade size, 10 ft stick', '', 11.40, 60, 'NG', 'IR',
     'B:80 V2:10', 'Trade Size=3/4 in'),
    ('CND-EMT-100', 'Conduit & Raceway/EMT', '1" EMT Conduit, 10 ft', 'Electrical metallic tubing, 1" trade size, 10 ft stick', '', 18.90, 20, 'NG', 'IR',
     'B:30', 'Trade Size=1 in'),
    ('CND-PVC-200', 'Conduit & Raceway/PVC', '2" Sch 40 PVC Conduit, 10 ft', 'Schedule 40 rigid PVC conduit, 2" trade size, belled end', '', 24.50, 10, 'NG', 'IR',
     'B:20 J101:2', 'Trade Size=2 in'),
    ('FIT-EMT-050-CON', 'Conduit & Raceway/Fittings', '1/2" EMT Set-Screw Connector', 'Zinc die-cast set-screw connector, 1/2" EMT', '', 0.48, 300, 'NG', 'IR',
     'B:500 V1:50 V2:100', 'Trade Size=1/2 in'),
    ('FIT-EMT-050-CPL', 'Conduit & Raceway/Fittings', '1/2" EMT Set-Screw Coupling', 'Zinc die-cast set-screw coupling, 1/2" EMT', '', 0.52, 300, 'NG', 'IR',
     'B:400 V2:100', 'Trade Size=1/2 in'),
    ('FIT-EMT-075-CON', 'Conduit & Raceway/Fittings', '3/4" EMT Set-Screw Connector', 'Zinc die-cast set-screw connector, 3/4" EMT', '', 0.82, 200, 'NG', 'IR',
     'B:300 V2:50', 'Trade Size=3/4 in'),
    ('FIT-EMT-075-CPL', 'Conduit & Raceway/Fittings', '3/4" EMT Set-Screw Coupling', 'Zinc die-cast set-screw coupling, 3/4" EMT', '', 0.89, 200, 'NG', 'IR',
     'B:250 V2:50', 'Trade Size=3/4 in'),
    ('FIT-MC-038', 'Conduit & Raceway/Fittings', '3/8" MC Snap-In Connector', 'Snap-in connector for 12/2-12/3 MC cable', '', 0.35, 500, 'NG', 'IR',
     'B:600 V2:100', 'Trade Size=3/8 in'),
    ('FIT-PVC-200-LB', 'Conduit & Raceway/Fittings', '2" PVC LB Conduit Body', 'Schedule 40 PVC type LB conduit body with cover, 2"', '', 14.20, 5, 'NG', 'IR',
     'B:10', 'Trade Size=2 in'),
    ('FIT-STRAP-050', 'Conduit & Raceway/Fittings', '1/2" EMT One-Hole Strap', 'Steel one-hole strap, 1/2" EMT', '', 0.12, 500, 'NG', 'FS',
     'B:1000 V2:100', 'Trade Size=1/2 in'),
    # Boxes
    ('BOX-1G-OW', 'Boxes & Enclosures', 'Single-Gang Old-Work Box', 'PVC single-gang old-work (remodel) box, 20 cu in', '', 1.35, 100, 'NG', 'AD',
     'C:300 V1:25 V3:25', ''),
    ('BOX-1G-NW', 'Boxes & Enclosures', 'Single-Gang New-Work Box', 'PVC single-gang nail-on new-work box, 18 cu in', '', 0.62, 200, 'NG', 'AD',
     'C:500 V1:50', ''),
    ('BOX-2G-NW', 'Boxes & Enclosures', 'Two-Gang New-Work Box', 'PVC two-gang nail-on new-work box, 32 cu in', '', 1.10, 100, 'NG', 'AD',
     'C:200 V1:20', ''),
    ('BOX-4SQ-150', 'Boxes & Enclosures', '4" Square Box, 1-1/2" Deep', 'Steel 4" square box, 1-1/2" deep, 1/2 & 3/4 KOs', '', 2.95, 100, 'NG', 'IR',
     'C:150 V2:20', ''),
    ('BOX-4SQ-MR', 'Boxes & Enclosures', '4" Square Mud Ring, 1-Gang', 'Single-device mud ring for 4" square box, 5/8" raised', '', 1.40, 100, 'NG', 'IR',
     'C:150 V2:20', ''),
    ('BOX-OCT-FAN', 'Boxes & Enclosures', 'Fan-Rated Ceiling Box', 'Steel 4" octagon fan/fixture box with brace, 70 lb fan rated', '', 6.75, 30, 'NG', 'IR',
     'C:60 V1:4', ''),
    # Wiring devices
    ('DEV-REC-15-WH', 'Wiring Devices/Receptacles', '15A Duplex Receptacle TR, White', 'Tamper-resistant 15A 125V duplex receptacle, residential grade', '', 0.95, 200, 'NG', 'AD',
     'C:400 V1:40 V3:20', 'Current Rating=15;Voltage Rating=125;Color=White'),
    ('DEV-REC-20-WH', 'Wiring Devices/Receptacles', '20A Duplex Receptacle TR, White', 'Tamper-resistant 20A 125V duplex receptacle, commercial spec grade', '', 3.40, 100, 'NG', 'AD',
     'C:200 V2:30', 'Current Rating=20;Voltage Rating=125;Color=White'),
    ('DEV-GFCI-20-WH', 'Wiring Devices/Receptacles', '20A GFCI Receptacle, White', 'Self-test 20A 125V GFCI receptacle, tamper and weather resistant', '', 18.50, 60, 'NG', 'AD',
     'C:18 V1:4 V3:6', 'Current Rating=20;Voltage Rating=125;Color=White'),
    ('DEV-REC-USB', 'Wiring Devices/Receptacles', 'USB-A/C Charging Receptacle', '15A TR duplex receptacle with USB-A and USB-C (30W) charging ports', '', 22.00, 12, 'NG', 'AD',
     'C:24', 'Current Rating=15;Voltage Rating=125;Color=White'),
    ('DEV-REC-1450', 'Wiring Devices/Receptacles', 'NEMA 14-50R Receptacle', '50A 125/250V 14-50R flush receptacle - ranges and EV', '', 12.80, 6, 'NG', 'AD',
     'C:12', 'Current Rating=50;Voltage Rating=250'),
    ('DEV-SW-SP-WH', 'Wiring Devices/Switches & Controls', 'Single-Pole Switch 15A, White', '15A 120/277V single-pole toggle switch', '', 1.10, 150, 'NG', 'AD',
     'C:300 V1:30', 'Current Rating=15;Voltage Rating=277;Poles=1;Color=White'),
    ('DEV-SW-3W-WH', 'Wiring Devices/Switches & Controls', '3-Way Switch 15A, White', '15A 120/277V three-way toggle switch', '', 2.35, 75, 'NG', 'AD',
     'C:150 V1:20', 'Current Rating=15;Voltage Rating=277;Color=White'),
    ('DEV-DIM-LED', 'Wiring Devices/Switches & Controls', 'LED/CFL Dimmer 150W', 'Single-pole/3-way slide dimmer, 150W LED / 600W incandescent', '', 19.75, 20, 'NG', 'AD',
     'C:40 V1:4', 'Power=150;Voltage Rating=120;Color=White'),
    ('DEV-OCC-SNS', 'Wiring Devices/Switches & Controls', 'PIR Occupancy Sensor Switch', 'Wall-box PIR occupancy/vacancy sensor, 120/277V, neutral required', '', 32.50, 15, 'BP', 'AD',
     'C:30', 'Voltage Rating=277;Color=White'),
    ('PLT-1G-DEC', 'Wiring Devices/Wall Plates', '1-Gang Decorator Plate, White', 'Polycarbonate 1-gang decorator/GFCI wall plate', '', 0.55, 200, 'NG', 'AD',
     'C:500 V1:50', 'Color=White'),
    ('PLT-1G-DUP', 'Wiring Devices/Wall Plates', '1-Gang Duplex Plate, White', 'Polycarbonate 1-gang duplex receptacle wall plate', '', 0.45, 200, 'NG', 'AD',
     'C:400 V1:50', 'Color=White'),
    # Circuit protection
    ('BRK-1P-15', 'Circuit Protection/Circuit Breakers', '15A 1-Pole Breaker', 'Plug-on 15A single-pole thermal-magnetic breaker, 10kAIC', '', 6.20, 30, 'NG', 'KC',
     'D:60 V3:6', 'Current Rating=15;Voltage Rating=120;Poles=1'),
    ('BRK-1P-20', 'Circuit Protection/Circuit Breakers', '20A 1-Pole Breaker', 'Plug-on 20A single-pole thermal-magnetic breaker, 10kAIC', '', 6.20, 40, 'NG', 'KC',
     'D:80 V3:6', 'Current Rating=20;Voltage Rating=120;Poles=1'),
    ('BRK-1P-20-DF', 'Circuit Protection/Circuit Breakers', '20A 1-Pole Dual Function AFCI/GFCI', 'Plug-on 20A dual-function combination AFCI + Class A GFCI breaker', '', 48.00, 20, 'NG', 'KC',
     'D:12 V1:2', 'Current Rating=20;Voltage Rating=120;Poles=1'),
    ('BRK-2P-30', 'Circuit Protection/Circuit Breakers', '30A 2-Pole Breaker', 'Plug-on 30A two-pole breaker, 120/240V', '', 14.50, 10, 'NG', 'KC',
     'D:20', 'Current Rating=30;Voltage Rating=240;Poles=2'),
    ('BRK-2P-60', 'Circuit Protection/Circuit Breakers', '60A 2-Pole Breaker', 'Plug-on 60A two-pole breaker, 120/240V', '', 19.80, 10, 'NG', 'KC',
     'D:6', 'Current Rating=60;Voltage Rating=240;Poles=2'),
    ('PNL-LC-200', 'Circuit Protection/Panels & Meter Sockets', '200A 40-Space Main Breaker Load Center', '200A 120/240V 1-phase indoor main-breaker load center, 40 spaces / 80 circuits', '', 285.00, 2,
     'NG', 'KC', 'D:3 J101:1', 'Current Rating=200;Voltage Rating=240'),
    ('PNL-MTR-200', 'Circuit Protection/Panels & Meter Sockets', '200A Ringless Meter Socket', '200A 4-jaw ringless overhead/underground meter socket, NEMA 3R', '', 89.00, 2, 'NG', 'KC',
     'D:4 J101:1', 'Current Rating=200;Voltage Rating=240'),
    ('DSC-60-NF', 'Circuit Protection/Disconnects', '60A Non-Fused Disconnect, NEMA 3R', '60A 240V non-fusible pull-out disconnect - AC and EV equipment', '', 42.00, 6, 'NG', 'KC',
     'D:10', 'Current Rating=60;Voltage Rating=240;Poles=2'),
    ('GRD-ROD-58-8', 'Grounding & Bonding', '5/8" x 8 ft Ground Rod', 'Copper-bonded steel ground rod, 5/8" x 8 ft', '', 18.00, 6, 'NG', 'FS',
     'D:10 J101:2', ''),
    ('GRD-CLAMP-58', 'Grounding & Bonding', '5/8" Acorn Ground Rod Clamp', 'Bronze direct-burial acorn clamp, 5/8" rod, #10-#2 conductor', '', 2.10, 20, 'NG', 'FS',
     'D:30 V1:4', ''),
    # Lighting / EV
    ('LGT-HB-150', 'Lighting/LED Fixtures', 'LED High-Bay 150W 5000K', 'Round UFO LED high-bay, 150W, 21,000 lm, 5000K, 0-10V dimming, 120-277V', '', 129.00, 20, 'BP', 'LW',
     'E:6', 'Power=150;Light Output=21000;Color Temperature=5000;Voltage Rating=277'),
    ('LGT-TRF-24', 'Lighting/LED Fixtures', 'LED Troffer 2x4 40W 4000K', 'Recessed 2x4 LED troffer, 40W, 5,200 lm, 4000K, 0-10V, 120-277V', '', 68.00, 24, 'BP', 'LW',
     'E:30 J102:12', 'Power=40;Light Output=5200;Color Temperature=4000;Voltage Rating=277'),
    ('LGT-WAFER-6', 'Lighting/LED Fixtures', '6" LED Wafer Downlight', 'Canless 6" LED wafer downlight, 12W, 5CCT selectable, IC rated, J-box included', '', 14.50, 48, 'BP', 'LW',
     'E:100 V1:12', 'Power=12;Light Output=1000;Voltage Rating=120'),
    ('LGT-EXIT-CMB', 'Lighting/Emergency & Exit', 'LED Exit / Emergency Combo', 'Red LED exit sign with dual adjustable emergency heads, 90 min battery', '', 46.00, 8, 'BP', 'LW',
     'E:15', 'Voltage Rating=277'),
    ('EV-L2-48', 'EV Charging', 'Level 2 EV Charger 48A Hardwired', '48A Level 2 EVSE, 240V hardwired, 25 ft cable, NEMA 4, Wi-Fi/OCPP', '', 649.00, 4, 'NG', 'CC',
     'E:2', 'Current Rating=48;Voltage Rating=240;Power=11500'),
    # Connectors, supports, consumables
    ('CON-WN-YEL', 'Connectors & Terminals', 'Twist-On Wire Connector, Yellow', 'Yellow twist-on connector, 2x18 to 4x14 AWG', '', 0.07, 1000, 'NG', 'AD',
     'F:3000 V1:200 V2:200 V3:200', ''),
    ('CON-WN-RED', 'Connectors & Terminals', 'Twist-On Wire Connector, Red', 'Red twist-on connector, 2x14 to 5x12 AWG', '', 0.09, 1000, 'NG', 'AD',
     'F:2000 V1:200 V2:200 V3:200', ''),
    ('CON-LEV-3', 'Connectors & Terminals', '3-Port Lever Connector', 'Inline 3-conductor lever-nut splicing connector, 24-12 AWG', '', 0.42, 500, 'NG', 'AD',
     'F:1000 V2:100', ''),
    ('SUP-BEAM-CLMP', 'Supports & Fasteners', '3/8" Beam Clamp', 'Malleable iron beam clamp, 3/8"-16 rod', '', 1.85, 100, 'NG', 'FS',
     'F:200 V2:20', ''),
    ('SUP-ROD-038', 'Supports & Fasteners', '3/8" Threaded Rod, 10 ft', 'Zinc-plated all-thread rod, 3/8"-16 x 10 ft', '', 7.40, 20, 'NG', 'FS',
     'F:50', ''),
    ('SUP-HB-CHAIN', 'Supports & Fasteners', 'High-Bay Chain Hanging Kit', 'Jack chain (5 ft) with S-hooks and safety cable for high-bay fixtures', '', 6.80, 20, 'BP', 'FS',
     'F:50', ''),
    ('SUP-STAPLE-NM', 'Supports & Fasteners', 'NM Cable Staple', 'Insulated staple for 14/2 to 10/3 NM-B cable', '', 0.03, 2000, 'NG', 'FS',
     'F:5000 V1:300', ''),
    ('SUP-TAPCON', 'Supports & Fasteners', '1/4" x 1-3/4" Concrete Screw', 'Hex head masonry screw, 1/4" x 1-3/4", blue coated', '', 0.18, 500, 'NG', 'FS',
     'F:1000 V2:100', ''),
    ('CNS-TAPE-BLK', 'Consumables', 'Electrical Tape 3/4" Black', 'Vinyl electrical tape, 3/4" x 66 ft, 7 mil', '', 1.10, 50, 'NG', 'FS',
     'F:100 V1:10 V2:10 V3:10', 'Color=Black'),
    ('CNS-PULL-LUBE', 'Consumables', 'Wire Pulling Lubricant, 1 qt', 'Water-based wire pulling lubricant, 1 quart', '', 9.50, 6, 'NG', 'FS',
     'F:12 V2:1', ''),
    # Tools (trackable items are created one per serial number)
    ('TL-DMM', 'Tools & Equipment', 'True-RMS Digital Multimeter', 'CAT IV 600V / CAT III 1000V true-RMS digital multimeter', '', 189.00, 0, 'NG', 'PV',
     'CRIB:1 V1:1 V2:1 V3:1', 'Voltage Rating=1000'),
    ('TL-CLAMP', 'Tools & Equipment', 'AC/DC Clamp Meter 600A', 'True-RMS AC/DC clamp meter, 600A, CAT IV 600V', '', 149.00, 0, 'NG', 'PV',
     'CRIB:1 V2:1 V3:1', 'Current Rating=600'),
    ('TL-FISH-240', 'Tools & Equipment', 'Steel Fish Tape, 240 ft', '1/8" steel fish tape, 240 ft, in case', '', 72.00, 0, 'NG', 'PV',
     'CRIB:1 V1:1 V2:1', ''),
    ('TL-BEND-075', 'Tools & Equipment', '3/4" EMT Hand Bender', 'Hand bender with handle, 3/4" EMT / 1/2" rigid', '', 52.00, 0, 'NG', 'PV',
     'CRIB:2 V2:1 V3:1', ''),
]
TRACKABLE = {'TL-DMM', 'TL-CLAMP'}
CONSUMABLE = {'CON-WN-YEL', 'CON-WN-RED', 'SUP-STAPLE-NM', 'CNS-TAPE-BLK', 'CNS-PULL-LUBE'}
TOOLS_CATEGORY = 'Tools & Equipment'

# --- Install kits (assemblies) with bills of materials -------------------------
KITS = [
    ('KIT-SVC-200', '200A Residential Service Upgrade Kit',
     'Meter socket, 200A main-breaker panel, SER feeder, grounding electrode system and branch breakers', {
         'PNL-MTR-200': 1, 'PNL-LC-200': 1, 'WIR-SER-4/0': 25, 'CND-PVC-200': 2, 'FIT-PVC-200-LB': 1,
         'GRD-ROD-58-8': 2, 'GRD-CLAMP-58': 2, 'WIR-BARE-4': 30, 'BRK-1P-15': 6, 'BRK-1P-20': 8,
         'BRK-1P-20-DF': 6, 'BRK-2P-30': 1, 'CON-WN-RED': 50, 'CNS-TAPE-BLK': 2}),
    ('KIT-KIT-RI', 'Kitchen Circuit Rough-In Kit',
     'Two 20A small-appliance circuits, dishwasher/disposal, lighting and 50A range circuit', {
         'WIR-NMB-12-2': 250, 'WIR-NMB-6-3': 40, 'BOX-1G-NW': 11, 'DEV-GFCI-20-WH': 4, 'DEV-REC-20-WH': 4,
         'DEV-SW-SP-WH': 3, 'DEV-REC-1450': 1, 'PLT-1G-DEC': 11, 'CON-WN-YEL': 40, 'SUP-STAPLE-NM': 60}),
    ('KIT-TI-OFFICE', 'Office Tenant Improvement Kit (per office)',
     'Lighting, controls, power and data rough-in for one private office', {
         'LGT-TRF-24': 4, 'DEV-OCC-SNS': 1, 'DEV-REC-20-WH': 4, 'BOX-4SQ-150': 5, 'BOX-4SQ-MR': 5,
         'WIR-MC-12-2': 120, 'FIT-MC-038': 10, 'PLT-1G-DUP': 4, 'PLT-1G-DEC': 1, 'CON-LEV-3': 20, 'WIR-CAT6-BLU': 150}),
    ('KIT-HB-150', 'LED High-Bay Install Kit (per fixture)',
     'One 150W high-bay with MC whip, box, hanging hardware and splices', {
         'LGT-HB-150': 1, 'WIR-MC-12-2': 40, 'FIT-MC-038': 2, 'BOX-4SQ-150': 1, 'SUP-HB-CHAIN': 1,
         'SUP-BEAM-CLMP': 2, 'CON-LEV-3': 3}),
    ('KIT-EV-48', '48A EV Charger Install Kit (per station)',
     '60A/240V branch circuit in 3/4" EMT with disconnect and hardwired 48A EVSE', {
         'EV-L2-48': 1, 'BRK-2P-60': 1, 'DSC-60-NF': 1, 'WIR-THHN-6-BLK': 60, 'WIR-THHN-6-RED': 60,
         'WIR-THHN-8-GRN': 60, 'CND-EMT-075': 5, 'FIT-EMT-075-CON': 4, 'FIT-EMT-075-CPL': 5, 'CNS-PULL-LUBE': 0.25}),
]
MARKUP = Decimal('1.35')

# --- Orders --------------------------------------------------------------------
# (reference, project, kit IPN, quantity, status, destination, days until target)
BUILDS = [
    ('BO-0001', 'PRJ-101', 'KIT-SVC-200', 1, BuildStatus.PRODUCTION, 'J101', 5),
    ('BO-0002', 'PRJ-101', 'KIT-KIT-RI', 1, BuildStatus.PENDING, 'J101', 14),
    ('BO-0003', 'PRJ-102', 'KIT-TI-OFFICE', 12, BuildStatus.PRODUCTION, 'J102', 10),
    ('BO-0004', 'PRJ-103', 'KIT-HB-150', 40, BuildStatus.PENDING, 'J103', 21),
    ('BO-0005', 'PRJ-104', 'KIT-EV-48', 8, BuildStatus.PENDING, 'J104', 30),
]
# (reference, supplier, project, status, supplier ref, days until target, [(IPN, qty)])
PURCHASE_ORDERS = [
    ('PO-0001', 'BP', 'PRJ-103', PurchaseOrderStatus.PLACED, 'BPL-88412', 10, [('LGT-HB-150', 40), ('SUP-HB-CHAIN', 20)]),
    ('PO-0002', 'RW', 'PRJ-103', PurchaseOrderStatus.PLACED, 'RWC-55190', 7, [('WIR-MC-12-2', 2500)]),
    ('PO-0003', 'NG', 'PRJ-104', PurchaseOrderStatus.PENDING, '', 21, [('EV-L2-48', 8), ('BRK-2P-60', 8), ('DSC-60-NF', 4)]),
    ('PO-0004', 'NG', None, PurchaseOrderStatus.PENDING, '', 14, [('DEV-GFCI-20-WH', 60), ('BRK-1P-20-DF', 24)]),
]
# (reference, customer, project, status, customer ref, days until target, [(IPN, qty)])
SALES_ORDERS = [
    ('SO-0001', 'ALV', 'PRJ-101', SalesOrderStatus.IN_PROGRESS, 'Contract 2026-014', 21,
     [('KIT-SVC-200', 1), ('KIT-KIT-RI', 1), ('LGT-WAFER-6', 12), ('DEV-DIM-LED', 2)]),
    ('SO-0002', 'RMG', 'PRJ-102', SalesOrderStatus.IN_PROGRESS, 'RMG-PO-7731', 30,
     [('KIT-TI-OFFICE', 12), ('LGT-EXIT-CMB', 6)]),
    ('SO-0003', 'HPL', 'PRJ-103', SalesOrderStatus.PENDING, 'HPL-CAPEX-118', 35, [('KIT-HB-150', 40)]),
    ('SO-0004', 'OAK', 'PRJ-104', SalesOrderStatus.PENDING, 'Board approval 2026-09', 45, [('KIT-EV-48', 8)]),
]


def money(value):
    return Decimal(str(value)).quantize(Decimal('0.01'))


def make_tree(model, path, description, **extra):
    """Create each level of a 'A/B/C' path; return the leaf."""
    parent = None
    for name in path.split('/'):
        node, _ = model.objects.get_or_create(name=name, parent=parent, defaults={'description': ''})
        parent = node
    parent.description = description
    for key, value in extra.items():
        setattr(parent, key, value)
    parent.save()
    return parent


def seed():
    admin = User.objects.filter(is_superuser=True).order_by('pk').first()
    target = lambda days: TODAY + timedelta(days=days)

    for key, value in SETTINGS.items():
        set_global_setting(key, value)

    projects = {code: ProjectCode.objects.create(code=code, description=desc) for code, desc in PROJECTS}
    locations = {key: make_tree(StockLocation, path, desc, structural=structural)
                 for key, (path, desc, structural) in LOCATIONS.items()}
    categories = {path: make_tree(PartCategory, path, desc, default_location=locations[loc])
                  for path, desc, loc in CATEGORIES}

    suppliers = {k: Company.objects.create(name=n, description=d, is_supplier=True, currency='USD')
                 for k, (n, d, _) in SUPPLIERS.items()}
    manufacturers = {k: Company.objects.create(name=n, description='Manufacturer', is_manufacturer=True)
                     for k, (n, _) in MANUFACTURERS.items()}
    customers, contacts, addresses = {}, {}, {}
    for i, (key, (name, desc, person, role, line1, city, state, zipcode)) in enumerate(CUSTOMERS.items()):
        company = Company.objects.create(name=name, description=desc, is_customer=True, currency='USD')
        customers[key] = company
        contacts[key] = Contact.objects.create(
            company=company, name=person, role=role, phone=f'217-555-01{10 + i}',
            email=f"{person.split()[0].lower()}@example.com")
        addresses[key] = Address.objects.create(
            company=company, title='Job site', primary=True, line1=line1,
            postal_city=city, province=state, postal_code=zipcode, country='United States')

    part_ct = ContentType.objects.get_for_model(Part)
    templates = {name: ParameterTemplate.objects.create(
        name=name, units=units, description=desc, choices=choices, model_type=part_ct)
        for name, (units, desc, choices) in TEMPLATES.items()}

    parts, supplier_parts, costs = {}, {}, {}
    for n, (ipn, cat, name, desc, units, cost, minimum, sup, mfr, stock, params) in enumerate(PARTS):
        is_tool = cat == TOOLS_CATEGORY
        part = Part.objects.create(
            IPN=ipn, name=name, description=desc, category=categories[cat], units=units,
            minimum_stock=minimum, purchaseable=True, component=not is_tool, salable=not is_tool,
            trackable=ipn in TRACKABLE, consumable=ipn in CONSUMABLE, active=True,
            default_location=categories[cat].default_location, creation_user=admin)
        parts[ipn], costs[ipn] = part, money(cost)

        mfr_name, mfr_code = MANUFACTURERS[mfr]
        mpart = ManufacturerPart.objects.create(
            part=part, manufacturer=manufacturers[mfr], MPN=f"{mfr_code}-{ipn.split('-', 1)[1]}")
        reel = units == 'ft'
        spart = SupplierPart.objects.create(
            part=part, supplier=suppliers[sup], manufacturer_part=mpart, primary=True,
            SKU=f'{SUPPLIERS[sup][2]}-{10000 + n * 7}', description=desc,
            packaging='500 ft reel' if reel else '', pack_quantity='500' if reel else '1')
        supplier_parts[ipn] = spart
        SupplierPriceBreak.objects.create(part=spart, quantity=1, price=money(cost), price_currency='USD')
        SupplierPriceBreak.objects.create(part=spart, quantity=1000 if reel else 50,
                                          price=money(cost * 0.88), price_currency='USD')

        for pair in params.split(';') if params else []:
            key, value = pair.split('=', 1)
            Parameter.objects.create(template=templates[key], content_object=part, data=value)

        for entry in stock.split():
            loc, qty = entry.split(':')
            qty = Decimal(qty)
            common = dict(part=part, location=locations[loc], supplier_part=spart,
                          purchase_price=money(cost), purchase_price_currency='USD')
            if part.trackable:  # one stock item per serial number
                for _ in range(int(qty)):
                    serial = StockItem.objects.filter(part=part).count() + 1
                    StockItem.objects.create(quantity=1, serial=str(serial), **common)
            else:
                StockItem.objects.create(quantity=qty, **common)

    for ipn, name, desc, bom in KITS:
        kit = Part.objects.create(
            IPN=ipn, name=name, description=desc, category=categories['Install Kits'],
            assembly=True, component=True, salable=True, purchaseable=False, active=True,
            default_location=locations['WH'], creation_user=admin)
        parts[ipn] = kit
        for ref, (sub, qty) in enumerate(bom.items(), start=1):
            BomItem.objects.create(part=kit, sub_part=parts[sub], quantity=Decimal(str(qty)),
                                   consumable=sub in CONSUMABLE, reference=f'L{ref:02d}')
        costs[ipn] = money(sum(costs[sub] * Decimal(str(qty)) for sub, qty in bom.items()))

    for ref, sup, prj, status, sup_ref, days, lines in PURCHASE_ORDERS:
        po = PurchaseOrder.objects.create(
            reference=ref, supplier=suppliers[sup], project_code=projects.get(prj), status=status.value,
            supplier_reference=sup_ref, description=f'Material for {prj}' if prj else 'Warehouse restock',
            created_by=admin, target_date=target(days), destination=locations['WH'],
            issue_date=TODAY if status == PurchaseOrderStatus.PLACED else None)
        for ipn, qty in lines:
            PurchaseOrderLineItem.objects.create(
                order=po, part=supplier_parts[ipn], quantity=qty, project_code=projects.get(prj),
                purchase_price=costs[ipn], purchase_price_currency='USD')

    sales_orders = {}
    for ref, cust, prj, status, cust_ref, days, lines in SALES_ORDERS:
        so = SalesOrder.objects.create(
            reference=ref, customer=customers[cust], contact=contacts[cust], address=addresses[cust],
            project_code=projects[prj], status=status.value, customer_reference=cust_ref,
            description=dict(PROJECTS)[prj], created_by=admin, target_date=target(days))
        sales_orders[prj] = so
        for ipn, qty in lines:
            SalesOrderLineItem.objects.create(
                order=so, part=parts[ipn], quantity=qty, project_code=projects[prj],
                sale_price=money(costs[ipn] * MARKUP), sale_price_currency='USD')

    for ref, prj, ipn, qty, status, dest, days in BUILDS:
        Build.objects.create(
            reference=ref, title=f'{parts[ipn].name} for {prj}', part=parts[ipn], quantity=qty,
            project_code=projects[prj], sales_order=sales_orders[prj], status=status.value,
            destination=locations[dest], take_from=locations['WH'], issued_by=admin, target_date=target(days))

    print(f'Seeded: {Part.objects.count()} parts, {StockItem.objects.count()} stock items, '
          f'{Company.objects.count()} companies, {ProjectCode.objects.count()} projects, '
          f'{PurchaseOrder.objects.count()} POs, {SalesOrder.objects.count()} SOs, {Build.objects.count()} builds')


if Part.objects.filter(IPN=MARKER_IPN).exists():
    print('Taka Electrical demo data already present - nothing to do.')
else:
    with transaction.atomic():
        seed()
