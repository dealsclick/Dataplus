let state = null;
let selectedOrderId = null;
let selectedProductId = null;
let orderDetailVisible = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error((await response.json()).error || "Request failed");
  return response.json();
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function dateLabel(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function simpleDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function profitFor(order) {
  return Number(order.total || 0) - Number(order.productCost || 0) - Number(order.marketplaceFees || 0) - Number(order.shippingCost || 0) - Number(order.refundAmount || 0);
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2600);
}

function setState(nextState) {
  state = nextState;
  if (!selectedOrderId || !state.orders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = state.orders[0]?.id || null;
  }
  if (!selectedProductId || !state.inventory.some((item) => item.id === selectedProductId)) {
    selectedProductId = state.inventory[0]?.id || null;
  }
  render();
}

function showView(id) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  $("#page-title").textContent = ({ dashboard: "Dashboard", orders: "Orders", "order-full": "Order Details", customers: "Customers", inventory: "Inventory", reports: "Reports", connections: "Sources" })[id];
  if (id === "order-full") renderFullOrderPage();
}

function renderMetrics() {
  $("#metric-open-orders").textContent = state.summary.openOrders;
  $("#metric-inventory").textContent = state.summary.inventoryCount;
  $("#metric-low-stock").textContent = state.summary.lowStock;
  $("#metric-reserved").textContent = state.summary.reserved;
  $("#metric-sales").textContent = money(state.summary.sales);
  $("#metric-customers").textContent = state.summary.customerCount || 0;
}

function renderDashboardOrders() {
  const openOrders = state.orders.filter((order) => order.status !== "confirmed").slice(0, 5);
  $("#dashboard-orders").innerHTML = openOrders.length
    ? openOrders.map((order) => `
      <div class="compact-row">
        <div>
          <strong>${order.orderNumber}</strong>
          <small>${order.source} / ${order.buyer} / ${order.sku}</small>
        </div>
        <button class="button secondary" data-confirm-order="${order.id}">Confirm</button>
      </div>
    `).join("")
    : `<p class="muted">No open orders right now.</p>`;
}

function renderSyncLog() {
  $("#sync-log").innerHTML = state.syncRuns.slice(0, 6).map((run) => `
    <div class="compact-row">
      <div>
        <strong>${run.source} ${run.type}</strong>
        <small>${run.message}</small>
      </div>
      <small>${dateLabel(run.createdAt)}</small>
    </div>
  `).join("");
}

function filteredOrders() {
  const query = $("#order-search").value.trim().toLowerCase();
  const status = $("#order-status").value;
  return state.orders.filter((order) => {
    const matchesStatus = status === "all" || order.status === status;
    const haystack = `${order.orderNumber} ${order.internalOrderNumber} ${order.marketplaceOrderNumber} ${order.marketplaceOrderId} ${order.source} ${order.buyer} ${order.customerNumber} ${order.sku} ${order.title}`.toLowerCase();
    return matchesStatus && haystack.includes(query);
  });
}

function renderOrders() {
  const orders = filteredOrders();
  if (!orders.some((order) => order.id === selectedOrderId)) {
    selectedOrderId = orders[0]?.id || state.orders[0]?.id || null;
  }

  renderOrderStats();
  document.querySelector(".orders-workspace")?.classList.toggle("detail-open", orderDetailVisible);
  $("#orders-list").innerHTML = orders.length
    ? `
      <div class="orders-table-wrap">
        <table class="orders-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all orders" /></th>
              <th>Orders</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Delivery</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((order) => {
              const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0) || order.qty || 1;
              return `
                <tr class="${order.id === selectedOrderId ? "selected" : ""}" data-select-order="${order.id}">
                  <td><input type="checkbox" aria-label="Select ${order.orderNumber}" /></td>
                  <td>
                    <strong>${order.orderNumber}</strong>
                    <small>${order.source} ref ${order.marketplaceOrderNumber || order.marketplaceOrderId || "n/a"}</small>
                  </td>
                  <td>${simpleDate(order.createdAt)}</td>
                  <td>
                    <span class="customer-chip">${initials(order.buyer)}</span>
                    ${order.buyer}
                  </td>
                  <td>${order.shipBy || "N/A"}</td>
                  <td>${itemCount} item${Number(itemCount) === 1 ? "" : "s"}</td>
                  <td>${money(order.total)}</td>
                  <td><span class="status ${order.status}">${labelStatus(order.status)}</span></td>
                  <td>
                    <div class="action-menu">
                      <button class="icon-button" data-action-menu="${order.id}" aria-label="Open order actions">...</button>
                      <div class="action-popover" data-menu-for="${order.id}">
                        <button data-order-action="approve" data-order-id="${order.id}">Approve order</button>
                        <button data-order-action="hold" data-order-id="${order.id}">Put on hold</button>
                        <button data-order-action="cancel" data-order-id="${order.id}">Cancel order</button>
                        <button data-select-order="${order.id}" data-open-detail>View details</button>
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<div class="empty-state">No orders match this filter.</div>`;

  renderOrderDetail();
}

function renderOrderStats() {
  const orders = state.orders || [];
  $("#orders-stat-total").textContent = orders.length;
  $("#orders-stat-approved").textContent = orders.filter((order) => ["approved", "confirmed"].includes(order.status)).length;
  $("#orders-stat-pending").textContent = orders.filter((order) => ["new", "ready", "hold"].includes(order.status)).length;
  $("#orders-stat-exceptions").textContent = orders.filter((order) => ["canceled", "returned"].includes(order.status)).length + (state.returns || []).length;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function labelStatus(status) {
  return ({ hold: "On hold", approved: "Approved", canceled: "Canceled", confirmed: "Success", ready: "Pending", new: "Pending" })[status] || status;
}

function renderOrderDetail() {
  const order = state.orders.find((row) => row.id === selectedOrderId);
  const detail = $("#order-detail");
  if (!order) {
    detail.innerHTML = `<div class="empty-state">Select an order to see details.</div>`;
    return;
  }

  const address = order.address || {};
  const items = order.items?.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty, price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1)) }];
  const costTotal = Number(order.productCost || 0) + Number(order.marketplaceFees || 0) + Number(order.shippingCost || 0) + Number(order.refundAmount || 0);
  const orderProfit = profitFor(order);
  const margin = Number(order.total || 0) ? (orderProfit / Number(order.total || 0)) * 100 : 0;
  const customer = (state.customers || []).find((item) => item.id === order.customerId);
  const customerOrders = state.orders.filter((item) => item.customerId === order.customerId);

  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${order.source}</p>
        <h2>${order.orderNumber}</h2>
        <p class="muted">Marketplace ref: ${order.marketplaceOrderNumber || order.marketplaceOrderId || "Not mapped"}</p>
        <span class="status ${order.status}">${order.status}</span>
      </div>
      ${order.status === "confirmed" ? `<span class="muted">Confirmed</span>` : `<button class="button" data-confirm-order="${order.id}">Confirm order</button>`}
    </div>

    <div class="detail-grid">
      <section>
        <h3>Buyer</h3>
        <p><strong>${order.buyer}</strong></p>
        <p>${order.customerNumber || "No customer profile"}${customer?.repeatCustomer ? " / Repeat customer" : ""}</p>
        <p>${order.buyerEmail || "No email"}</p>
        <p>${order.phone || "No phone"}</p>
      </section>
      <section>
        <h3>Ship To</h3>
        <p><strong>${address.name || order.buyer}</strong></p>
        <p>${address.line1 || ""}${address.line2 ? `, ${address.line2}` : ""}</p>
        <p>${[address.city, address.state, address.postalCode].filter(Boolean).join(", ")}</p>
      </section>
      <section>
        <h3>Marketplace</h3>
        <p>Internal: ${order.internalOrderNumber || order.orderNumber}</p>
        <p>Reference: ${order.marketplaceOrderNumber || order.marketplaceOrderId || "Not mapped"}</p>
        <p>Ship by: ${order.shipBy}</p>
        <p>${order.shippingService}</p>
      </section>
      <section>
        <h3>Profit</h3>
        <p>Sales: ${money(order.total)}</p>
        <p>Costs: ${money(costTotal)}</p>
        <p><strong>${money(orderProfit)} / ${margin.toFixed(1)}%</strong></p>
      </section>
    </div>

    <section class="detail-section">
      <h3>Profit and Loss</h3>
      <div class="money-editor">
        <label>Gross sales<input type="number" step="0.01" value="${order.total}" data-order-money="total" data-order-id="${order.id}" /></label>
        <label>Product cost<input type="number" step="0.01" value="${order.productCost || 0}" data-order-money="productCost" data-order-id="${order.id}" /></label>
        <label>Marketplace fees<input type="number" step="0.01" value="${order.marketplaceFees || 0}" data-order-money="marketplaceFees" data-order-id="${order.id}" /></label>
        <label>Shipping cost<input type="number" step="0.01" value="${order.shippingCost || 0}" data-order-money="shippingCost" data-order-id="${order.id}" /></label>
        <label>Refunds<input type="number" step="0.01" value="${order.refundAmount || 0}" data-order-money="refundAmount" data-order-id="${order.id}" /></label>
      </div>
      <div class="pnl-strip">
        <span><small>Net profit</small><strong>${money(orderProfit)}</strong></span>
        <span><small>Margin</small><strong>${margin.toFixed(1)}%</strong></span>
        <span><small>Break-even</small><strong>${money(costTotal)}</strong></span>
      </div>
    </section>

    <section class="detail-section">
      <h3>Customer Profile</h3>
      <div class="pnl-strip">
        <span><small>Customer</small><strong>${customer?.customerNumber || "None"}</strong></span>
        <span><small>Orders</small><strong>${customerOrders.length}</strong></span>
        <span><small>Lifetime value</small><strong>${money(customer?.lifetimeValue || 0)}</strong></span>
      </div>
      <div class="mini-history">
        ${customerOrders.slice(0, 5).map((item) => `
          <button data-select-order="${item.id}">
            <strong>${item.orderNumber}</strong>
            <span>${item.source} / ${money(item.total)} / ${simpleDate(item.createdAt)}</span>
          </button>
        `).join("") || `<p class="muted">No history yet.</p>`}
      </div>
    </section>

    <section class="detail-section">
      <h3>Items</h3>
      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Qty</th><th>Price</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${item.sku}</strong></td>
              <td>${item.title}</td>
              <td>${item.qty}</td>
              <td>${money(item.price)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>

    <section class="detail-section">
      <h3>Shipping and Notes</h3>
      <p>Tracking: ${order.trackingNumber || "Not available yet"}</p>
      <p>${order.notes || "No notes."}</p>
    </section>
  `;
}

function renderFullOrderPage() {
  const order = state.orders.find((row) => row.id === selectedOrderId) || state.orders[0];
  const target = $("#full-order-page");
  if (!order) {
    target.innerHTML = `<div class="empty-state">Select an order first.</div>`;
    return;
  }

  const address = order.address || {};
  const items = order.items?.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty, price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1)) }];
  const customer = (state.customers || []).find((item) => item.id === order.customerId);
  const costTotal = Number(order.productCost || 0) + Number(order.marketplaceFees || 0) + Number(order.shippingCost || 0) + Number(order.refundAmount || 0);
  const orderProfit = profitFor(order);
  const timeline = order.timeline || [];

  target.innerHTML = `
    <div class="full-order">
      <div class="full-order-head">
        <button class="text-button" data-view-jump="orders">Back to orders</button>
        <div>
          <p class="eyebrow">${order.source} / ${order.marketplaceOrderNumber || "No marketplace reference"}</p>
          <h2>${order.orderNumber}</h2>
        </div>
        <div class="full-order-actions">
          <button class="button secondary" data-order-action="hold" data-order-id="${order.id}">Put on hold</button>
          <button class="button secondary" data-order-action="cancel" data-order-id="${order.id}">Cancel</button>
          <button class="button" data-order-action="approve" data-order-id="${order.id}">Approve order</button>
        </div>
      </div>

      <div class="full-order-grid">
        <section class="full-card span-2">
          <h3>Order Summary</h3>
          <div class="summary-grid">
            <span><small>Status</small><strong><span class="status ${order.status}">${labelStatus(order.status)}</span></strong></span>
            <span><small>Customer</small><strong>${customer?.customerNumber || "None"}</strong></span>
            <span><small>Total</small><strong>${money(order.total)}</strong></span>
            <span><small>Profit</small><strong>${money(orderProfit)}</strong></span>
            <span><small>Cost</small><strong>${money(costTotal)}</strong></span>
            <span><small>Ship by</small><strong>${order.shipBy || "N/A"}</strong></span>
          </div>
        </section>

        <section class="full-card">
          <h3>Customer</h3>
          <p><strong>${order.buyer}</strong></p>
          <p>${order.buyerEmail || "No email"}</p>
          <p>${order.phone || "No phone"}</p>
          <p class="muted">${customer?.repeatCustomer ? "Repeat customer" : "New customer"}</p>
        </section>

        <section class="full-card">
          <h3>Ship To</h3>
          <p><strong>${address.name || order.buyer}</strong></p>
          <p>${address.line1 || ""}${address.line2 ? `, ${address.line2}` : ""}</p>
          <p>${[address.city, address.state, address.postalCode].filter(Boolean).join(", ")}</p>
          <p>${address.country || ""}</p>
        </section>

        <section class="full-card span-2">
          <h3>Items</h3>
          <div class="table-wrap compact-table">
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
              <tbody>
                ${items.map((item) => `
                  <tr>
                    <td><strong>${item.sku}</strong></td>
                    <td>${item.title}</td>
                    <td>${item.qty}</td>
                    <td>${money(item.price)}</td>
                    <td>${money(Number(item.price || 0) * Number(item.qty || 0))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="full-card">
          <h3>Add Note</h3>
          <textarea id="order-note-input" rows="5" placeholder="Add an internal note"></textarea>
          <button class="button note-button" data-add-order-note="${order.id}">Add note</button>
        </section>

        <section class="full-card">
          <h3>Shipping</h3>
          <p>Service: ${order.shippingService || "Not selected"}</p>
          <p>Tracking: ${order.trackingNumber || "Not available yet"}</p>
          <p>Marketplace ref: ${order.marketplaceOrderNumber || order.marketplaceOrderId || "N/A"}</p>
        </section>
      </div>

      <section class="timeline-card">
        <div class="panel-head">
          <h2>Timeline</h2>
          <span class="muted">${timeline.length} events</span>
        </div>
        <div class="timeline">
          ${timeline.map((event) => `
            <article class="timeline-event ${event.type}">
              <span class="timeline-dot"></span>
              <div>
                <strong>${event.title}</strong>
                <p>${event.message || ""}</p>
                <small>${event.user || "System"} / ${dateLabel(event.createdAt)}</small>
              </div>
            </article>
          `).join("") || `<p class="muted">No events yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderCustomers() {
  const query = $("#customer-search").value.trim().toLowerCase();
  const customers = (state.customers || []).filter((customer) => {
    const address = customer.defaultAddress || {};
    const haystack = `${customer.customerNumber} ${customer.name} ${customer.email} ${customer.phone} ${address.city} ${address.state}`.toLowerCase();
    return haystack.includes(query);
  });

  $("#customer-grid").innerHTML = customers.length
    ? customers.map((customer) => {
      const orders = state.orders.filter((order) => order.customerId === customer.id);
      const lastOrder = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return `
        <article class="customer-card">
          <div class="customer-head">
            <div>
              <p class="eyebrow">${customer.customerNumber}</p>
              <h2>${customer.name}</h2>
              <p class="muted">${customer.email || "No email"} / ${customer.phone || "No phone"}</p>
            </div>
            <span class="status ${customer.repeatCustomer ? "live" : "draft"}">${customer.repeatCustomer ? "Repeat" : "New"}</span>
          </div>
          <div class="pnl-strip">
            <span><small>Orders</small><strong>${customer.totalOrders}</strong></span>
            <span><small>Lifetime value</small><strong>${money(customer.lifetimeValue)}</strong></span>
            <span><small>Last order</small><strong>${lastOrder ? simpleDate(lastOrder.createdAt) : "None"}</strong></span>
          </div>
          <div class="mini-history">
            ${orders.slice(0, 4).map((order) => `
              <button data-select-order="${order.id}" data-view-jump="orders">
                <strong>${order.orderNumber}</strong>
                <span>${order.source} ref ${order.marketplaceOrderNumber || order.marketplaceOrderId || "n/a"} / ${money(order.total)}</span>
              </button>
            `).join("")}
          </div>
        </article>
      `;
    }).join("")
    : `<div class="empty-state">No customers match this search.</div>`;
}

function renderInventory() {
  const query = $("#inventory-search").value.trim().toLowerCase();
  const items = state.inventory.filter((item) => `${item.sku} ${item.title} ${item.brand} ${item.category}`.toLowerCase().includes(query));
  if (!items.some((item) => item.id === selectedProductId)) {
    selectedProductId = items[0]?.id || state.inventory[0]?.id || null;
  }

  $("#product-list").innerHTML = items.length
    ? items.map((item) => {
      const available = Number(item.qty || 0) - Number(item.reserved || 0);
      const profit = Number(item.price || 0) - Number(item.cost || 0);
      return `
        <button class="product-card ${item.id === selectedProductId ? "active" : ""}" data-select-product="${item.id}">
          <span>
            <strong>${item.sku}</strong>
            <small>${item.title}</small>
          </span>
          <span>
            <strong>${money(item.price || 0)}</strong>
            <small>${available} available / ${money(profit)} profit</small>
          </span>
          <span class="status ${String(item.status || "draft").toLowerCase()}">${item.status || "Draft"}</span>
        </button>
      `;
    }).join("")
    : `<div class="empty-state">No products match this filter.</div>`;

  renderProductDetail();
}

function renderProductDetail() {
  const item = state.inventory.find((row) => row.id === selectedProductId);
  const detail = $("#product-detail");
  if (!item) {
    detail.innerHTML = `<div class="empty-state">Select a product to edit launch details.</div>`;
    return;
  }

  const available = Number(item.qty || 0) - Number(item.reserved || 0);
  const grossProfit = Number(item.price || 0) - Number(item.cost || 0);
  const margin = Number(item.price || 0) ? (grossProfit / Number(item.price || 0)) * 100 : 0;
  const imagesText = (item.images || []).join("\n");
  const tagsText = (item.tags || []).join(", ");

  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${item.category || "Product"}</p>
        <h2>${item.sku}</h2>
        <span class="status ${String(item.status || "draft").toLowerCase()}">${item.status || "Draft"}</span>
      </div>
      <div class="profit-pill">
        <small>Gross profit</small>
        <strong>${money(grossProfit)} / ${margin.toFixed(1)}%</strong>
      </div>
    </div>

    <div class="image-strip">
      ${(item.images || []).slice(0, 4).map((image) => `<img src="${image}" alt="${item.title}" />`).join("") || `<div class="image-placeholder">No images</div>`}
    </div>

    <div class="product-form">
      <section>
        <h3>Core Listing</h3>
        <label>Internal title<input value="${item.title || ""}" data-product-field="title" data-product-id="${item.id}" /></label>
        <label>Marketplace title<input value="${item.marketplaceTitle || ""}" data-product-field="marketplaceTitle" data-product-id="${item.id}" /></label>
        <label>Short description<textarea rows="3" data-product-field="shortDescription" data-product-id="${item.id}">${item.shortDescription || ""}</textarea></label>
        <label>Long description<textarea rows="7" data-product-field="longDescription" data-product-id="${item.id}">${item.longDescription || ""}</textarea></label>
      </section>

      <section>
        <h3>Pricing and Inventory</h3>
        <div class="form-grid">
          <label>Price<input type="number" step="0.01" value="${item.price || 0}" data-product-field="price" data-product-id="${item.id}" /></label>
          <label>Cost<input type="number" step="0.01" value="${item.cost || 0}" data-product-field="cost" data-product-id="${item.id}" /></label>
          <label>MSRP<input type="number" step="0.01" value="${item.msrp || 0}" data-product-field="msrp" data-product-id="${item.id}" /></label>
          <label>On hand<input type="number" min="0" value="${item.qty || 0}" data-product-field="qty" data-product-id="${item.id}" /></label>
          <label>Reserved<input type="number" min="0" value="${item.reserved || 0}" data-product-field="reserved" data-product-id="${item.id}" /></label>
          <label>Reorder point<input type="number" min="0" value="${item.reorderPoint || 0}" data-product-field="reorderPoint" data-product-id="${item.id}" /></label>
        </div>
        <div class="pnl-strip">
          <span><small>Available</small><strong>${available}</strong></span>
          <span><small>Potential sales</small><strong>${money(Number(item.price || 0) * available)}</strong></span>
          <span><small>Potential profit</small><strong>${money(grossProfit * available)}</strong></span>
        </div>
      </section>

      <section>
        <h3>Catalog Data</h3>
        <div class="form-grid">
          <label>Brand<input value="${item.brand || ""}" data-product-field="brand" data-product-id="${item.id}" /></label>
          <label>Category<input value="${item.category || ""}" data-product-field="category" data-product-id="${item.id}" /></label>
          <label>Condition<input value="${item.condition || ""}" data-product-field="condition" data-product-id="${item.id}" /></label>
          <label>Status<input value="${item.status || ""}" data-product-field="status" data-product-id="${item.id}" /></label>
          <label>Barcode / UPC<input value="${item.barcode || ""}" data-product-field="barcode" data-product-id="${item.id}" /></label>
          <label>Vendor<input value="${item.vendor || ""}" data-product-field="vendor" data-product-id="${item.id}" /></label>
        </div>
        <label>SEO keywords<input value="${item.seoKeywords || ""}" data-product-field="seoKeywords" data-product-id="${item.id}" /></label>
        <label>Tags<input value="${tagsText}" data-product-field="tags" data-product-id="${item.id}" /></label>
      </section>

      <section>
        <h3>Images and Shipping</h3>
        <label>Image URLs<textarea rows="4" data-product-field="images" data-product-id="${item.id}">${imagesText}</textarea></label>
        <div class="form-grid">
          <label>Weight oz<input type="number" step="0.1" value="${item.weightOz || 0}" data-product-field="weightOz" data-product-id="${item.id}" /></label>
          <label>Length in<input type="number" step="0.1" value="${item.lengthIn || 0}" data-product-field="lengthIn" data-product-id="${item.id}" /></label>
          <label>Width in<input type="number" step="0.1" value="${item.widthIn || 0}" data-product-field="widthIn" data-product-id="${item.id}" /></label>
          <label>Height in<input type="number" step="0.1" value="${item.heightIn || 0}" data-product-field="heightIn" data-product-id="${item.id}" /></label>
        </div>
      </section>
    </div>
  `;
}

function groupBy(list, keyFn) {
  return list.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function renderReports() {
  const orders = state.orders;
  const sales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const productCost = orders.reduce((sum, order) => sum + Number(order.productCost || 0), 0);
  const fees = orders.reduce((sum, order) => sum + Number(order.marketplaceFees || 0), 0);
  const shipping = orders.reduce((sum, order) => sum + Number(order.shippingCost || 0), 0);
  const refunds = orders.reduce((sum, order) => sum + Number(order.refundAmount || 0), 0) + (state.returns || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const profit = sales - productCost - fees - shipping - refunds;

  $("#report-sales").textContent = money(sales);
  $("#report-profit").textContent = money(profit);
  $("#report-returns").textContent = String((state.returns || []).length);
  $("#report-cancellations").textContent = String((state.cancellations || []).length);

  const sourceGroups = groupBy(orders, (order) => order.source);
  const maxSourceSales = Math.max(1, ...Object.values(sourceGroups).map((sourceOrders) => sourceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)));
  $("#source-performance").innerHTML = Object.entries(sourceGroups).map(([source, sourceOrders]) => {
    const sourceSales = sourceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    return `
      <div class="bar-row">
        <div>
          <strong>${source}</strong>
          <small>${sourceOrders.length} orders / ${money(sourceSales)}</small>
        </div>
        <span style="width:${Math.max(8, (sourceSales / maxSourceSales) * 100)}%"></span>
      </div>
    `;
  }).join("");

  $("#pnl-summary").innerHTML = [
    ["Gross sales", sales],
    ["Product cost", -productCost],
    ["Marketplace fees", -fees],
    ["Shipping cost", -shipping],
    ["Returns/refunds", -refunds],
    ["Estimated profit", profit]
  ].map(([label, value]) => `
    <div class="compact-row">
      <strong>${label}</strong>
      <strong>${money(value)}</strong>
    </div>
  `).join("");

  const productGroups = groupBy(orders.flatMap((order) => (order.items || []).map((item) => ({ ...item, source: order.source, profit: profitFor(order), orderTotal: Number(order.total || 0) }))), (item) => item.sku);
  $("#product-performance").innerHTML = `
    <table>
      <thead><tr><th>SKU</th><th>Product</th><th>Units</th><th>Sales</th><th>Est. profit</th></tr></thead>
      <tbody>
        ${Object.entries(productGroups).map(([sku, rows]) => `
          <tr>
            <td><strong>${sku}</strong></td>
            <td>${rows[0]?.title || ""}</td>
            <td>${rows.reduce((sum, row) => sum + Number(row.qty || 0), 0)}</td>
            <td>${money(rows.reduce((sum, row) => sum + Number(row.price || 0) * Number(row.qty || 0), 0))}</td>
            <td>${money(rows.reduce((sum, row) => sum + Number(row.profit || 0), 0))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const exceptions = [
    ...(state.returns || []).map((item) => ({ ...item, type: "Return" })),
    ...(state.cancellations || []).map((item) => ({ ...item, type: "Cancellation" }))
  ];
  $("#exception-list").innerHTML = exceptions.length
    ? exceptions.map((item) => `
      <div class="compact-row">
        <div>
          <strong>${item.type} / ${item.orderNumber}</strong>
          <small>${item.source} / ${item.reason} / ${item.sku}</small>
        </div>
        <strong>${money(item.amount)}</strong>
      </div>
    `).join("")
    : `<p class="muted">No returns or cancellations.</p>`;
}

function renderConnections() {
  $("#connection-grid").innerHTML = state.connections.map((connection) => `
    <article class="connection-card">
      <h2>${connection.name}</h2>
      <p>${connection.name === "Temu" && state.connectorState?.temuAuthorized
        ? `Authorized${state.connectorState.temuMallId ? ` / Mall ${state.connectorState.temuMallId}` : ""} / Last sync ${dateLabel(connection.lastSync)}`
        : connection.connected ? `Connected / Last sync ${dateLabel(connection.lastSync)}` : "Ready for API credentials when you connect the real marketplace account."}</p>
      ${connection.name === "Temu" ? `
        <div class="auth-box">
          <label>Authorization code<input id="temu-auth-code" placeholder="Paste code from Temu redirect" /></label>
          <button class="button secondary" data-exchange-temu-code>Save token</button>
        </div>
      ` : ""}
      <button class="button ${connection.connected ? "secondary" : ""}" data-sync-source="${connection.name}">
        ${connection.name === "Temu" ? "Sync orders" : connection.connected ? "Sync now" : "Connect demo"}
      </button>
    </article>
  `).join("");
}

function render() {
  renderMetrics();
  renderDashboardOrders();
  renderSyncLog();
  renderOrders();
  renderCustomers();
  renderInventory();
  renderReports();
  renderConnections();
  if ($("#order-full").classList.contains("active")) renderFullOrderPage();
}

async function load() {
  setState(await api("/api/state"));
}

async function confirmOrder(id) {
  const result = await api(`/api/orders/${id}/confirm`, { method: "POST" });
  selectedOrderId = id;
  setState(result.state);
  toast("Order confirmed and inventory updated.");
}

async function runOrderAction(id, action) {
  const result = await api(`/api/orders/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
  selectedOrderId = id;
  setState(result.state);
  toast(`Order ${labelStatus(result.order.status).toLowerCase()}.`);
}

async function addOrderNote(id) {
  const note = $("#order-note-input")?.value.trim();
  if (!note) {
    toast("Add a note first.");
    return;
  }
  const result = await api(`/api/orders/${id}/notes`, { method: "POST", body: JSON.stringify({ note }) });
  selectedOrderId = id;
  setState(result.state);
  toast("Note added.");
}

async function syncSource(source) {
  const result = await api(`/api/sync/${encodeURIComponent(source)}`, { method: "POST" });
  setState(result.state);
  toast(`${source} sync complete.`);
}

async function exchangeTemuCode() {
  const input = $("#temu-auth-code");
  const code = input?.value.trim();
  if (!code) {
    toast("Paste the Temu authorization code first.");
    return;
  }
  const result = await api("/api/temu/exchange-code", { method: "POST", body: JSON.stringify({ code }) });
  setState(result.state);
  toast("Temu token saved.");
}

async function updateInventory(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.inventoryId);
  if (!item) return;
  const payload = { [input.dataset.inventoryField]: Number(input.value) };
  const result = await api(`/api/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  item.qty = result.item.qty;
  item.reserved = result.item.reserved;
  item.reorderPoint = result.item.reorderPoint;
  state.summary = result.summary;
  render();
  toast("Inventory updated.");
}

async function updateProductField(input) {
  const item = state.inventory.find((row) => row.id === input.dataset.productId);
  if (!item) return;
  const field = input.dataset.productField;
  const numericFields = new Set(["qty", "reserved", "reorderPoint", "price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn"]);
  const payload = { [field]: numericFields.has(field) ? Number(input.value) : input.value };
  const result = await api(`/api/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(item, result.item);
  state.summary = result.summary;
  render();
  toast("Product updated.");
}

async function updateOrderMoney(input) {
  const order = state.orders.find((row) => row.id === input.dataset.orderId);
  if (!order) return;
  const field = input.dataset.orderMoney;
  const result = await api(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ [field]: Number(input.value) }) });
  selectedOrderId = order.id;
  setState(result.state);
  toast("Order P&L updated.");
}

async function importInventory(file) {
  const csv = await file.text();
  const result = await api("/api/import/inventory", { method: "POST", body: JSON.stringify({ csv }) });
  setState(result.state);
  toast(`Imported ${result.changed} inventory rows.`);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  const jumpButton = event.target.closest("[data-view-jump]");
  const confirmButton = event.target.closest("[data-confirm-order]");
  const syncButton = event.target.closest("[data-sync-source]");
  const orderButton = event.target.closest("[data-select-order]");
  const productButton = event.target.closest("[data-select-product]");
  const exchangeTemuButton = event.target.closest("[data-exchange-temu-code]");
  const actionMenuButton = event.target.closest("[data-action-menu]");
  const orderActionButton = event.target.closest("[data-order-action]");
  const openDetailButton = event.target.closest("[data-open-detail]");
  const addNoteButton = event.target.closest("[data-add-order-note]");

  if (addNoteButton) {
    addOrderNote(addNoteButton.dataset.addOrderNote);
    return;
  }
  if (orderActionButton) {
    event.stopPropagation();
    runOrderAction(orderActionButton.dataset.orderId, orderActionButton.dataset.orderAction);
    return;
  }
  if (viewButton) showView(viewButton.dataset.view);
  if (jumpButton) showView(jumpButton.dataset.viewJump);
  if (confirmButton) confirmOrder(confirmButton.dataset.confirmOrder);
  if (syncButton) syncSource(syncButton.dataset.syncSource);
  if (actionMenuButton) {
    event.stopPropagation();
    const id = actionMenuButton.dataset.actionMenu;
    document.querySelectorAll(".action-popover.open").forEach((menu) => {
      if (menu.dataset.menuFor !== id) menu.classList.remove("open");
    });
    document.querySelector(`[data-menu-for="${id}"]`)?.classList.toggle("open");
    return;
  }
  if (orderButton) {
    selectedOrderId = orderButton.dataset.selectOrder;
    if (openDetailButton) {
      showView("order-full");
      return;
    }
    renderOrders();
  }
  if (productButton) {
    selectedProductId = productButton.dataset.selectProduct;
    renderInventory();
  }
  if (exchangeTemuButton) exchangeTemuCode();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu")) {
    document.querySelectorAll(".action-popover.open").forEach((menu) => menu.classList.remove("open"));
  }
});

$("#sync-all").addEventListener("click", async () => {
  for (const connection of state.connections) {
    await syncSource(connection.name);
  }
});

$("#order-search").addEventListener("input", renderOrders);
$("#order-status").addEventListener("change", renderOrders);
$("#toggle-order-detail").addEventListener("click", () => {
  orderDetailVisible = !orderDetailVisible;
  $("#toggle-order-detail").textContent = orderDetailVisible ? "Hide details" : "Show details";
  renderOrders();
});
$("#customer-search").addEventListener("input", renderCustomers);
$("#inventory-search").addEventListener("input", renderInventory);
$("#inventory-import").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importInventory(file);
  event.target.value = "";
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-inventory-field]");
  const productInput = event.target.closest("[data-product-field]");
  const orderMoneyInput = event.target.closest("[data-order-money]");
  if (input) updateInventory(input);
  if (productInput) updateProductField(productInput);
  if (orderMoneyInput) updateOrderMoney(orderMoneyInput);
});

load().catch((error) => toast(error.message));
