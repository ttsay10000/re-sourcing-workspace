# Condominiums and NYC Open Data Datasets – Research Summary

## Why condos often return no rows

For **condominium** addresses, Geoclient returns a **billing BBL** (lot in the 75xx range), not the **base (tax) lot** that most NYC Open Data datasets use. Many datasets either exclude billing BBLs or key records by the building’s **base BBL** or **BIN**.

---

## 1. How NYC treats condos: unit lots vs. billing BBL

- **Unit BBL:** Each condo unit can have its own tax lot (e.g. 7501, 7502, … for units, or 1001, 1002 in some complexes).
- **Billing BBL:** DOF assigns one **billing BBL** per condominium **complex** (e.g. 1007167507 for “428 WEST 19TH STREET CONDOMINIUM”).  
  - Used for building-wide matters: code violations, inspections, sanitation, etc.  
  - **Not** a physical tax lot; not lienable.  
  - Geoclient returns this for a condo building address.
- **Base BBL:** The **actual tax lot** where the building sits (e.g. block 716, lot **52** → `1007160052`).  
  - This is the lot that appears on the Digital Tax Map and in DCP’s zoning/PLUTO-style data.  
  - One base lot per building; condo units within it are identified by unit/billing identifiers.

Source: [Geosupport VI.4 Condominiums and Billing BBLs](https://nycplanning.github.io/Geosupport-UPG/chapters/chapterVI/section04/), PLUTO README (one record per condo complex, billing lot when assigned).

---

## 2. Dataset-by-dataset behavior

### Zoning Tax Lot Database (fdkv-4t4z)

- **Source:** Department of Finance **Digital Tax Map** (actual tax lots only).
- **Condos:** Contains the **base lot** (e.g. 52), **not** the billing BBL (e.g. 7507).  
  - Billing BBLs are not real tax lots, so they do not appear in this dataset.
- **Effect:** A query by `bbl = '1007167507'` returns **no rows**; the same building’s zoning is under **base BBL** `1007160052`.

### PLUTO

- **Condos:** One record **per condominium complex**, using the **billing** tax lot when assigned (otherwise lowest lot in the block for that complex).  
  - So PLUTO is keyed by billing/complex, while the Zoning Tax Lot Database is keyed by base lot.

### HPD Multiple Dwelling Registrations (tesw-yqqr)

- **Key:** `boro`, `block`, `lot` (and BuildingID/BIN in other HPD data).
- **Condos:** Registration is at the **building** level.  
  - It may be stored under the **base** block/lot (52) or under another identifier; it is **not** necessarily under the billing lot (7507).  
  - For 428 W 19th (Linea), no rows were found for either lot 52 or 7507 in the sample check; building may be unregistered or keyed differently (e.g. BIN).

### HPD Housing Maintenance Code Violations (wvxf-dwi5)

- Same idea as registrations: building-level, often keyed by **base** block/lot or BIN, not necessarily by billing BBL.  
  - Querying by billing BBL (block 716, lot 7507) can return no rows even when the building has violations under the base lot.

### DOB NOW Build – Approved Permits (rbx6-tga4)

- **Key:** `bbl` (and other fields).  
- **Condos:** Permits are tied to the **base** BBL (e.g. 1007160052), not the billing BBL (1007167507).  
  - So permit data for 428 W 19th is under base BBL.

### DOB NOW Certificate of Occupancy (pkdm-hqz6)

- Same as permits: keyed by **base** BBL (and BIN).  
  - CO for Linea is under 1007160052, not 1007167507.

### Housing Litigations (59kj-x8nc)

- Can be keyed by BBL (and/or BIN).  
  - For condos, may use base or billing depending on how the case was filed; in the sample, no rows for base 1007160052.

### Affordable Housing (hg8x-zxpr)

- Project-level; may use base or billing BBL depending on how the project was recorded.

### DOB Complaints (eabe-havv)

- **BIN-only** in the dataset.  
  - Condos are affected only if we have the correct **BIN** (e.g. 1012562 for Linea). Geoclient often returns a placeholder BIN (e.g. 1000000) for condos, so DOB complaints may be missing unless BIN is resolved elsewhere.

---

## 3. Mapping billing BBL → base BBL

**NYC Open Data – Digital Tax Map: Condominiums (p8u6-a6it)**

- **`condo_billing_bbl`** = billing BBL (e.g. 1007167507).  
- **`condo_base_bbl`** = base (tax) lot BBL (e.g. 1007160052).  
- **`condo_name`** = e.g. "428 WEST 19TH STREET CONDOMINIUM".

So for any billing BBL we can do:

- Query: `condo_billing_bbl = '<our_bbl>'` → take **`condo_base_bbl`** and use that for:
  - Zoning (fdkv-4t4z)
  - Permits (rbx6-tga4)
  - Certificate of Occupancy (pkdm-hqz6)
  - HPD registration/violations (tesw-yqqr, wvxf-dwi5) when filtering by boro/block/lot

---

## 4. Practical recommendation

1. **Resolve condo billing → base BBL**  
   When Geoclient returns a BBL, check the CONDO dataset (p8u6-a6it) for `condo_billing_bbl = <bbl>`.  
   - If found: treat the property as a condo and use **`condo_base_bbl`** for all BBL-based and boro/block/lot-based API queries.  
   - If not found: use the Geoclient BBL as-is (non-condo or already base).

2. **Use base BBL everywhere we key by BBL or by block/lot**  
   - Zoning, permits, CO, HPD registration, HPD violations, housing litigations, affordable housing: use the **base** BBL (or its boro/block/lot) so condos return the same building-level data as the rest of the system.

3. **BIN for condos**  
   - Geoclient often does not return a reliable BIN for condos (e.g. 1000000).  
   - DOB Complaints (and any BIN-only dataset) will only return rows if we obtain the real BIN (e.g. from DOB permits/CO or another source) and use it for that dataset.

---

## 5. Example: Linea Condominium (428 West 19th Street)

| Identifier   | Value        | Source / meaning                          |
|-------------|--------------|-------------------------------------------|
| Billing BBL | 1007167507   | Geoclient for this address                |
| Base BBL    | 1007160052   | p8u6-a6it `condo_base_bbl` for that billing |
| BIN         | 1012562      | From DOB permits/CO (not from Geoclient)  |

- **Zoning:** Rows only for **1007160052** (base), none for 1007167507 (billing).  
- **Permits / CO:** Same: data under **1007160052**.  
- **HPD reg/violations:** In the sample, no rows for block 716 lot 52 or 7507; if present, they would be under the building’s key (base lot or BIN).  
- **DOB Complaints:** Would require BIN **1012562**; Geoclient’s placeholder BIN is not useful.

---

## 6. References

- Geosupport UPG: [VI.4 Condominiums and Billing BBLs](https://nycplanning.github.io/Geosupport-UPG/chapters/chapterVI/section04/)
- PLUTO README (condo = one record per complex, billing lot)
- NYC Open Data: [CONDO (p8u6-a6it)](https://data.cityofnewyork.us/City-Government/CONDO/p8u6-a6it), [Zoning Tax Lot (fdkv-4t4z)](https://data.cityofnewyork.us/City-Government/NYC-Zoning-Tax-Lot-Database/fdkv-4t4z)
- Zoning Tax Lot Database metadata (DCP, Digital Tax Map source)
