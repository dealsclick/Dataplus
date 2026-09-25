# Mobile Operations Shell

DataPlus uses the same React routes, permissions and APIs on desktop and mobile. At phone widths, the shared application shell provides:

- Bottom navigation for Home, Orders, Catalog and Jobs.
- A More drawer containing the remaining permitted workspaces and account utilities.
- Parent-aware active states for order, product, inventory, category and job details.
- A compact header with company selection, global search and David.
- Safe-area spacing, horizontally scrollable tabs, 16 px form inputs and full-screen dialogs with sticky actions.
- A phone-specific Catalog Products list with touch-sized selection and actions, product images, readiness, stock, price, supplier, category and channel state. The desktop table is not rendered below 768 px.

Desktop retains the collapsible sidebar. The dedicated `/warehouse/mobile` route remains the scanner-first warehouse experience and does not render the general application shell.
