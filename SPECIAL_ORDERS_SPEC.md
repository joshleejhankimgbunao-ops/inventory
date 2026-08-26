# Special Orders Feature Spec

## Purpose

Add a lightweight Special Orders workflow for items requested by customers but not kept in regular stock. The feature should support sourcing from suppliers or nearby hardware stores, tracking the order until fulfillment, and recording the completion in Sales Reports and History Logs.

This feature is intentionally smaller than a full procurement system. It should support operational tracking without turning special orders into normal inventory.

## Business Fit

This workflow is practical for a medium-sized hardware and construction supplies business because it matches a common real-world process: a customer requests an item, staff sources it manually, then sells it directly to the customer.

The design should stay simple enough for daily use by store staff while still giving management visibility into status, cost, and margin.

## Recommended Scope

Keep the module focused on these functions:

- Create special order requests
- Track order status through fulfillment
- Record supplier and pricing details
- Complete the order into a sales record
- Log the lifecycle in history/audit trails
- Exclude the item from regular inventory unless staff explicitly decides otherwise

Do not include:

- Purchase order approval chains
- Receiving and warehouse stock posting
- Automatic supplier invoicing
- Multi-step procurement accounting

## Recommended Workflow

1. Staff creates a special order from a customer request.
2. Staff enters requested item details, expected arrival, supplier, costs, and remarks.
3. The order starts in Pending status.
4. Staff updates the order as it moves to In Progress and Ready for Pickup.
5. When fulfilled, the order is completed and written into sales/history reporting.
6. The ordered item does not automatically become part of stock.
7. If the customer cancels, the order is closed as Cancelled with a reason.

## Suggested Statuses

- Pending
- In Progress
- Ready for Pickup
- Completed
- Cancelled

Recommended transition rules:

- Pending -> In Progress
- In Progress -> Ready for Pickup
- Ready for Pickup -> Completed
- Any active status -> Cancelled
- Completed should be terminal except for admin corrections

## Recommended Database Design

Use a separate collection for special orders instead of reusing the product or inventory model.

### SpecialOrder

- orderNumber: human-readable unique reference
- customerId: optional link to customer/partner record
- customerName: snapshot text for reporting and walk-ins
- itemName: requested item name
- description: optional details/specifications
- quantity: requested quantity
- supplierId: optional link to supplier/partner record
- supplierName: snapshot text for sourcing reference
- purchaseCost: actual or expected supplier cost
- sellingPrice: customer selling price
- expectedArrivalDate: optional target date
- status: Pending, In Progress, Ready for Pickup, Completed, Cancelled
- remarks: internal notes
- createdBy: user reference
- updatedBy: user reference
- completedBy: user reference
- cancelledBy: user reference
- cancelledReason: text
- completedAt: timestamp
- cancelledAt: timestamp
- linkedSaleId: reference to sale record created on completion
- createdAt / updatedAt: timestamps

### Optional Status History

If you want better auditability, add a lightweight embedded history array:

- status
- changedBy
- changedAt
- note

This is useful if you want to explain delays or cancellations later.

## Reporting Behavior

When a special order is completed:

- It should appear in Sales Reports
- It should appear in History Logs
- It should carry its own label or type so it can be distinguished from normal POS sales
- It should not auto-create stock movement or inventory quantity

Recommended reporting approach:

- Create a normal sale ledger entry for the financial record
- Mark the record as Special Order so reports can filter it separately
- Keep the special order record itself as the operational source of truth

## UI / UX Flow

### Entry Points

- Sidebar module: Special Orders
- Quick action in POS when requested item is unavailable
- Optional shortcut from customer profile or partner record

### Main Screens

1. List view
- Status chips
- Search by customer, item, supplier, or order number
- Filters for status and date range

2. Create / edit form
- Customer
- Item name
- Description
- Quantity
- Supplier
- Purchase cost
- Selling price
- Expected arrival date
- Remarks

3. Detail view
- Full order summary
- Status timeline
- Audit trail
- Completion / cancellation actions
- Linked sale reference after completion

### UX Principle

Keep the module fast to use. Staff should be able to create a request in under a minute during a customer conversation.

## Behavior Rules

### On Create

- Save as Pending
- Log the action in history
- Do not deduct inventory
- Allow customer and supplier to be either linked records or plain text snapshots

### On Edit

- Allow edits while not Completed or Cancelled
- After completion, restrict edits to administrative fields or notes if needed
- Preserve snapshots so later partner name changes do not rewrite historical records

### On Complete

- Create a sales record for reporting
- Link the sale back to the special order
- Mark the special order as Completed
- Write an activity/history log entry
- Do not add the item to normal inventory by default

### On Cancel

- Require a cancellation reason
- Keep the record for audit purposes
- Do not delete the order
- Do not create inventory changes unless a separate return/restock flow is explicitly handled

## POS Integration Recommendation

Keep Special Orders as a separate module, but integrate it lightly with POS.

Why:

- POS should remain optimized for instant checkout
- Special orders have a slower lifecycle and need status tracking
- A separate module reduces complexity and UI clutter

Best compromise:

- Add a button in POS for creating a special order when an item is unavailable
- Allow staff to jump back into the Special Orders module to continue fulfillment
- Use the sales system only when the order is completed

## Edge Cases to Plan For

- Customer cancels after the item has already been purchased
- Supplier cost changes before fulfillment
- Requested item is substituted with a different item
- Walk-in customer without a saved customer record
- Multiple items requested in one order
- Partial fulfillment or delayed arrival
- Order completed but customer has not yet picked it up
- Returned item from cancelled special order
- Special order completed offline and synced later

## Risks

- If special orders are treated exactly like normal sales, inventory and reporting will become confusing
- If the workflow becomes too detailed, staff may avoid using it and revert to manual notes
- If the sale record does not explicitly mark special orders, reports will mix them with normal POS revenue
- If snapshots are not stored, later partner name edits may distort history

## Design Improvements

Recommended improvements before implementation:

- Add an explicit Special Order type flag in the sale record
- Store snapshot names even when linked IDs exist
- Keep status history for operational clarity
- Add a clear rule for cancellation after purchasing the item
- Add report filters so management can separate normal sales from special order sales

## Suggested Implementation Phases

1. Phase 1: Special order creation, listing, status updates, and cancellation
2. Phase 2: Completion flow that generates a sales record and history log
3. Phase 3: Reporting filters and POS shortcut integration
4. Phase 4: Optional status history and richer audit trail

## Summary

This feature should be treated as a lightweight fulfillment workflow, not a procurement system. The safest architecture is a dedicated SpecialOrder record for operational tracking plus a linked sale record when the order is completed. That approach preserves clean inventory behavior, keeps reporting accurate, and stays manageable for a medium-sized hardware business.