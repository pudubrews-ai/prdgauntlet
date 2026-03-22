# PRD: Multi-Model PRD Gauntlet v4.0

[Previous sections remain unchanged through FR4.1...]

#### FR4.2: Test Generation Process

**Input:**
- Approved PRD with complete integration chains (from FR3)
- Target test framework specification
- System architecture metadata (language, frameworks)

**Process:**

1. **Parse PRD** to extract all Integration Chain blocks

2. **Identify pattern type** for each chain:
   - Linear chain → single test case
   - Conditional logic → multiple test cases (one per branch)
   - Fan-out → single test with parallel assertions
   - Fan-in → multiple test cases (one per entry point)
   - Async operations → test with async/await and completion verification

3. **For each chain, generate:**
   - Setup code (test fixtures, mocks)
   - Action execution (simulate user/system trigger)
   - Assertions (verify each layer's behavior)
   - Teardown code (cleanup)

4. **Generate contract tests** for each component interface

5. **Generate negative test cases** for documented error scenarios

**Pattern-Specific Generation Rules:**

**Conditional Logic:**
- **Input**: Integration chain with IF/ELSE IF/ELSE branches
- **Output**: Separate test case for each branch
- **Example**:
```typescript
// Generated from FR3.1 Conditional Logic example
describe('Review Approval - Conditional Branches', () => {
  it('should approve high-scoring review (score >= 8.0)', async () => {
    // Setup: review with score = 9.0
    const review = await ReviewRepository.create({ score: 9.0 });
    
    // Action
    const { getByText } = render(<ReviewForm reviewId={review.id} />);
    fireEvent.click(getByText('Approve Review'));
    
    // Assertions - IF branch
    await waitFor(() => {
      expect(NotificationService.notifyAuthor).toHaveBeenCalledWith('approved');
      expect(AnalyticsService.trackApproval).toHaveBeenCalled();
    });
  });

  it('should request secondary review (5.0 <= score < 8.0)', async () => {
    // Setup: review with score = 6.0
    const review = await ReviewRepository.create({ score: 6.0 });
    
    // Action
    const { getByText } = render(<ReviewForm reviewId={review.id} />);
    fireEvent.click(getByText('Approve Review'));
    
    // Assertions - ELSE IF branch
    await waitFor(() => {
      expect(ReviewService.requestSecondaryReview).toHaveBeenCalled();
      expect(NotificationService.notifyReviewer).toHaveBeenCalledWith('secondary_needed');
    });
  });

  it('should reject low-scoring review (score < 5.0)', async () => {
    // Setup: review with score = 3.0
    const review = await ReviewRepository.create({ score: 3.0 });
    
    // Action
    const { getByText } = render(<ReviewForm reviewId={review.id} />);
    fireEvent.click(getByText('Approve Review'));
    
    // Assertions - ELSE branch
    await waitFor(() => {
      expect(ReviewService.reject).toHaveBeenCalled();
    });
  });
});
```

**Fan-Out:**
- **Input**: Integration chain with ⊢→ parallel operations
- **Output**: Single test case with Promise.allSettled or equivalent robust error handling
- **Strategy**: Use Promise.allSettled (or language equivalent) to ensure all operations complete regardless of individual failures
- **Example**:
```typescript
// Generated from FR3.1 Fan-Out example
describe('Order Placement - Fan-Out Operations', () => {
  it('should execute all parallel operations successfully', async () => {
    // Setup
    const product = await setupTestProduct();
    
    // Action
    const { getByText } = render(<CheckoutForm />);
    fireEvent.click(getByText('Place Order'));
    
    // Assertions - Use Promise.allSettled to verify all operations attempted
    await waitFor(async () => {
      // Collect all parallel operation results
      const results = await Promise.allSettled([
        Promise.resolve(InventoryService.reserveItems.mock.results[0]),
        Promise.resolve(PaymentService.processPayment.mock.results[0]),
        Promise.resolve(NotificationService.sendConfirmation.mock.results[0]),
        Promise.resolve(AnalyticsService.trackPurchase.mock.results[0])
      ]);
      
      // Verify all operations were attempted (not short-circuited)
      expect(InventoryService.reserveItems).toHaveBeenCalled();
      expect(PaymentService.processPayment).toHaveBeenCalled();
      expect(NotificationService.sendConfirmation).toHaveBeenCalled();
      expect(AnalyticsService.trackPurchase).toHaveBeenCalled();
      
      // Verify all succeeded
      results.forEach((result, index) => {
        expect(result.status).toBe('fulfilled');
      });
    });
    
    // Verify data layer updates from all branches
    const order = await OrderRepository.findLatest();
    expect(order).toBeDefined();
    
    const inventory = await InventoryRepository.findByProduct(product.id);
    expect(inventory.stock).toBeLessThan(product.stock); // Stock reduced
    
    const payment = await PaymentRepository.findByOrder(order.id);
    expect(payment.status).toBe('completed');
  });

  it('should handle partial failure in fan-out operations', async () => {
    // Setup - Mock PaymentService to fail
    PaymentService.processPayment.mockRejectedValue(new Error('Payment failed'));
    
    // Action
    const { getByText } = render(<CheckoutForm />);
    fireEvent.click(getByText('Place Order'));
    
    // Wait for all operations to complete using allSettled pattern
    await waitFor(async () => {
      // Verify all operations were attempted despite failure
      expect(InventoryService.reserveItems).toHaveBeenCalled();
      expect(PaymentService.processPayment).toHaveBeenCalled();
      expect(NotificationService.sendConfirmation).toHaveBeenCalled();
      expect(AnalyticsService.trackPurchase).toHaveBeenCalled();
    });
    
    // Give system time to execute compensation logic
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Assertions - Verify rollback/compensation logic executed
    expect(InventoryService.releaseReservation).toHaveBeenCalled();
    expect(NotificationService.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ 
        error: expect.stringContaining('Payment failed') 
      })
    );
    
    // Verify partial completion state in data layer
    const order = await OrderRepository.findLatest();
    expect(order.status).toBe('failed');
    
    const inventory = await InventoryRepository.findByProduct(product.id);
    expect(inventory.stock).toBe(product.stock); // Stock restored after rollback
  });

  it('should report individual operation failures in fan-out', async () => {
    // Setup - Mock multiple services to fail
    InventoryService.reserveItems.mockRejectedValue(new Error('Out of stock'));
    PaymentService.processPayment.mockResolvedValue({ success: true });
    NotificationService.sendConfirmation.mockRejectedValue(new Error('Email service down'));
    AnalyticsService.trackPurchase.mockResolvedValue({ tracked: true });
    
    // Action
    const { getByText } = render(<CheckoutForm />);
    fireEvent.click(getByText('Place Order'));
    
    // Wait and collect results using allSettled pattern
    await waitFor(async () => {
      const operations = [
        { name: 'InventoryService.reserveItems', mock: InventoryService.reserveItems },
        { name: 'PaymentService.processPayment', mock: PaymentService.processPayment },
        { name: 'NotificationService.sendConfirmation', mock: NotificationService.sendConfirmation },
        { name: 'AnalyticsService.trackPurchase', mock: AnalyticsService.trackPurchase }
      ];
      
      // Verify all were called
      operations.forEach(op => {
        expect(op.mock).toHaveBeenCalled();
      });
    });
    
    // Verify error aggregation
    await waitFor(() => {
      expect(ErrorReportingService.reportFanOutFailures).toHaveBeenCalledWith(
        expect.objectContaining({
          failed: ['InventoryService.reserveItems', 'NotificationService.sendConfirmation'],
          succeeded: ['PaymentService.processPayment', 'AnalyticsService.trackPurchase']
        })
      );
    });
  });
});
```

**Python pytest equivalent (for reference):**
```python
# Generated fan-out test for Python/pytest
@pytest.mark.asyncio
async def test_order_placement_fanout_partial_failure():
    """Should handle partial failure in fan-out operations"""
    # Setup - Mock payment service to fail
    with patch('services.payment.PaymentService.process_payment', 
               side_effect=Exception('Payment failed')):
        with patch('services.inventory.InventoryService.reserve_items') as mock_inventory:
            with patch('services.notification.NotificationService.send_confirmation') as mock_notification:
                with patch('services.analytics.AnalyticsService.track_purchase') as mock_analytics:
                    
                    # Action
                    response = await order_service.process_order(order_data)
                    
                    # Wait for all operations using asyncio.gather with return_exceptions=True
                    # This ensures all coroutines run to completion
                    results = await asyncio.gather(
                        mock_inventory.wait_until_called(),
                        mock_notification.wait_until_called(),
                        mock_analytics.wait_until_called(),
                        return_exceptions=True  # Key: Don't stop on first exception
                    )
                    
                    # Verify all operations were attempted
                    assert mock_inventory.called
                    assert mock_notification.called
                    assert mock_analytics.called
                    
                    # Verify compensation logic
                    assert InventoryService.release_reservation.called
                    assert NotificationService.send_error.called
```

**Fan-In:**
- **Input**: Integration chain with ⊣ multiple entry points
- **Output**: Separate test case for each entry point
- **Example**:
```typescript
// Generated from FR3.1 Fan-In example
describe('Review Submission - Fan-In Entry Points', () => {
  it('should submit review via ReviewForm', async () => {
    const { getByText } = render(<ReviewForm />);
    fireEvent.click(getByText('Submit Review'));
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/reviews/123/submit',
        expect.objectContaining({ method: 'POST' })
      );
    });
    
    const review = await ReviewRepository.findById('123');
    expect(review.status).toBe('submitted');
  });

  it('should submit review via QuickReviewButton', async () => {
    const { getByRole } = render(<QuickReviewButton reviewId="123" />);
    fireEvent.click(getByRole('button'));
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/reviews/123/submit',
        expect.objectContaining({ method: 'POST' })
      );
    });
    
    const review = await ReviewRepository.findById('123');
    expect(review.status).toBe('submitted');
  });

  it('should submit reviews via BulkReviewPanel', async () => {
    const { getByText } = render(<BulkReviewPanel reviewIds={['1', '2', '3']} />);
    fireEvent.click(getByText('Submit All'));
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
      ['1', '2', '3'].forEach(id => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/reviews/${id}/submit`,
          expect.objectContaining({ method: 'POST' })
        );
      });
    });
  });
});
```

**Asynchronous Operations:**
- **Input**: Integration chain with [ASYNC BOUNDARY] marker
- **Output**: Test with async/await, polling, or event listeners
- **Example**:
```typescript
// Generated from FR3.1 Async Operations example
describe('File Processing - Asynchronous Operations', () => {
  it('should complete full async processing flow', async () => {
    // Setup WebSocket listener for real-time updates
    const statusUpdates = [];
    const ws = new MockWebSocket();
    ws.on('file.status', (data) => statusUpdates.push(data));
    
    // Action - UI Layer
    const file = new File(['test content'], 'test.txt');
    const { getByLabelText } = render(<FileUploadForm />);
    const input = getByLabelText('Upload File');
    fireEvent.change(input, { target: { files: [file] } });
    
    // API Layer verification
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/files/upload',
        expect.objectContaining({ method: 'POST' })
      );
    });
    
    // Business Layer - Verify message queued
    expect(MessageQueue.publish).toHaveBeenCalledWith(
      'file.processing',
      expect.objectContaining({ fileId: expect.any(String) })
    );
    
    // [ASYNC BOUNDARY] - Simulate background worker processing
    const fileId = MessageQueue.publish.mock.calls[0][1].fileId;
    await FileProcessingWorker.processMessage({ fileId });
    
    // Verify background processing completed
    expect(FileService.processFile).toHaveBeenCalledWith(fileId);
    expect(StorageService.saveProcessed).toHaveBeenCalled();
    expect(NotificationService.notifyComplete).toHaveBeenCalled();
    
    // Data Layer - Verify final status
    const fileRecord = await FileRepository.findById(fileId);
    expect(fileRecord.status).toBe('processed');
    
    // Verify real-time updates were sent
    expect(statusUpdates).toContainEqual(
      expect.objectContaining({ fileId, status: 'processed' })
    );
  }, 10000); // Extended timeout for async operations

  it('should handle processing failures with retry logic', async () => {
    // Setup - Mock processing to fail once then succeed
    FileService.processFile
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ success: true });
    
    const fileId = 'test-file-123';
    
    // Simulate worker consuming message
    await FileProcessingWorker.processMessage({ fileId });
    
    // Verify retry was attempted
    expect(FileService.processFile).toHaveBeenCalledTimes(2);
    expect(MessageQueue.publish).toHaveBeenCalledWith(
      'file.processing.retry',
      expect.objectContaining({ fileId, attempt: 1 })
    );
    
    // Verify eventual success
    const fileRecord = await FileRepository.findById(fileId);
    expect(fileRecord.status).toBe('processed');
  }, 15000); // Extended timeout for retry logic
});
```

**Output Structure:**
```
tests/
  integration/
    review_submission_linear.test.ts
    review_approval_conditional.test.ts          # Conditional logic
    order_placement_fanout.test.ts               # Fan-out
    review_submission_fanin.test.ts              # Fan-in
    file_processing_async.test.ts                # Async operations
  contracts/
    api_reviews.contract.test.ts
    ui_review_form.contract.test.ts
  negative/
    review_validation_errors.test.ts
```

**Acceptance Criteria:**
- Generated tests are syntactically valid for target framework
- Tests include comments mapping back to PRD section
- Each test covers at least 3 system layers (e.g., UI → API → Data)
- Test generation completes in < 60 seconds
- **Conditional logic**: One test case per branch with explicit setup for branch conditions
- **Fan-out**: Tests use `Promise.allSettled` (JavaScript) or `asyncio.gather(..., return_exceptions=True)` (Python) or equivalent to ensure all operations execute regardless of individual failures
- **Fan-out**: Tests verify all operations were attempted (called/invoked) even in partial failure scenarios
- **Fan-out**: Tests include assertions on compensation/rollback logic for failed operations
- **Fan-in**: One test case per documented entry point (⊣ notation)
- **Async operations**: Tests include timeout configuration (≥ 5 seconds for async tests)
- **Async operations**: Tests verify completion via polling, event listeners, or message queue consumers

[Remaining sections FR4.3 through Appendices remain unchanged...]

---
