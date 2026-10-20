# Taka Electrical

The inventory and (later) project system for a small electrical contracting business: what stock it has, where that stock is, and the work it is used on.

## People

**Owner**:
The electrical contractor who runs the business and is the primary user of the system.
_Avoid_: Client, boss, admin

**Customer**:
A person or company the Owner does electrical work for.
_Avoid_: Client, end customer

**Technician**:
An employee of the Owner who does the electrical work on site.
_Avoid_: Field technician, electrician, employee, crew member

## Stock

**Van**:
A service vehicle owned by the business that carries stock; not tied to one Technician.
_Avoid_: Truck, truck stock

**Minimum Stock**:
The quantity of a part the business wants on hand in total, counted across the warehouse, every Van and every Job Site; below it, the part is low.
_Avoid_: Reorder point, par level

**On Order**:
The quantity of a part on open purchase orders that are not for a Project; it reduces how much the Owner needs to reorder but does not make a part stop being low.
_Avoid_: Incoming, pending stock

## Work

**Project**:
A piece of electrical work for a Customer at one address.
_Avoid_: Job

**Job Site**:
The place where a Project happens, including the stock staged there for it.
_Avoid_: Site (on its own), job location

**Quotation**:
The price the Owner offers a Customer for a Project, which the Customer accepts, rejects or counters.
_Avoid_: Quote, estimate, invoice

**Invoice**:
A request for payment sent to a Customer after the work; distinct from a Quotation.
_Avoid_: Bill
