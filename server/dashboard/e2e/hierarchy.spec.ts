/**
 * E2E Tests for Memory Hierarchy Dashboard
 * 
 * Tests the complete user flow including:
 * - Viewing hierarchy pyramid
 * - Filtering by layer and importance
 * - Viewing memory details
 * - Batch operations
 * - Conflict resolution
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8000';

test.describe('Memory Hierarchy Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to memories page
    await page.goto(`${BASE_URL}/dashboard/memories`);
    await page.waitForLoadState('networkidle');
  });

  test('should display hierarchy pyramid', async ({ page }) => {
    // Check if pyramid component is visible
    await expect(page.getByText('Memory Hierarchy')).toBeVisible();
    
    // Verify all 5 layers are present
    await expect(page.getByText('L0')).toBeVisible();
    await expect(page.getByText('L1')).toBeVisible();
    await expect(page.getByText('L2')).toBeVisible();
    await expect(page.getByText('L3')).toBeVisible();
    await expect(page.getByText('L4')).toBeVisible();
    
    // Check for layer labels
    await expect(page.getByText('Canonical')).toBeVisible();
    await expect(page.getByText('Core')).toBeVisible();
    await expect(page.getByText('Episodic')).toBeVisible();
  });

  test('should filter memories by layer', async ({ page }) => {
    // Open filters
    await page.getByText('Filters').click();
    
    // Uncheck all layers first
    const layers = ['L0', 'L1', 'L2', 'L3', 'L4'];
    for (const layer of layers) {
      const checkbox = page.getByLabel(`layer-${layer}`);
      if (await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }
    
    // Select only L1
    await page.getByLabel('layer-L1').check();
    
    // Wait for filtered results
    await page.waitForTimeout(500);
    
    // Verify only L1 memories are shown
    const memoryItems = page.locator('[data-layer]');
    const count = await memoryItems.count();
    
    for (let i = 0; i < count; i++) {
      const layer = await memoryItems.nth(i).getAttribute('data-layer');
      expect(layer).toBe('L1');
    }
  });

  test('should filter by importance range', async ({ page }) => {
    // Open filters
    await page.getByText('Filters').click();
    
    // Set importance range to 8-10 (high importance only)
    const slider = page.locator('[role="slider"]').first();
    await slider.fill('8');
    
    await page.waitForTimeout(500);
    
    // Verify filtered results have importance >= 8
    const importanceValues = await page.locator('[data-importance]').allTextContents();
    importanceValues.forEach(value => {
      const importance = parseFloat(value);
      expect(importance).toBeGreaterThanOrEqual(8);
    });
  });

  test('should view memory details', async ({ page }) => {
    // Click on first memory item
    await page.locator('[data-memory-id]').first().click();
    
    // Verify detail view is shown
    await expect(page.getByText('Memory Metrics')).toBeVisible();
    await expect(page.getByText('Importance')).toBeVisible();
    await expect(page.getByText('Weight')).toBeVisible();
    
    // Check for timestamps
    await expect(page.getByText('Created:')).toBeVisible();
  });

  test('should perform batch operations', async ({ page }) => {
    // Select multiple memories
    const checkboxes = page.locator('input[type="checkbox"][data-memory-select]');
    await checkboxes.first().check();
    await checkboxes.nth(1).check();
    
    // Verify batch actions bar appears
    await expect(page.getByText('2 selected')).toBeVisible();
    
    // Open batch actions menu
    await page.getByText('Batch Actions').click();
    
    // Verify actions are available
    await expect(page.getByText('Mark as L0')).toBeVisible();
    await expect(page.getByText('Adjust Importance')).toBeVisible();
    await expect(page.getByText('Delete Selected')).toBeVisible();
  });

  test('should adjust importance for selected memories', async ({ page }) => {
    // Select one memory
    await page.locator('input[type="checkbox"][data-memory-select]').first().check();
    
    // Open batch actions and select adjust importance
    await page.getByText('Batch Actions').click();
    await page.getByText('Adjust Importance').click();
    
    // Dialog should open
    await expect(page.getByText('Set new importance score')).toBeVisible();
    
    // Enter new importance
    await page.locator('input[type="number"]').fill('9.0');
    
    // Click apply (don't actually submit in test)
    await expect(page.getByText('Apply')).toBeVisible();
  });

  test('should display conflicts when present', async ({ page }) => {
    // Navigate to conflicts section (if exists)
    const conflictsSection = page.getByText('Detected Conflicts');
    
    if (await conflictsSection.isVisible()) {
      // Verify conflict UI elements
      await expect(page.getByText('Existing')).toBeVisible();
      await expect(page.getByText('New')).toBeVisible();
      
      // Check for resolution buttons
      await expect(page.getByText('Keep Existing')).toBeVisible();
      await expect(page.getByText('Keep New')).toBeVisible();
      await expect(page.getByText('Merge Both')).toBeVisible();
    } else {
      // No conflicts should show success message
      await expect(page.getByText('No conflicts detected')).toBeVisible();
    }
  });

  test('should view relationship graph', async ({ page }) => {
    // Click on a memory
    await page.locator('[data-memory-id]').first().click();
    
    // Click view graph button
    await page.getByText('View Relationship Graph').click();
    
    // Verify graph is displayed
    await expect(page.locator('.react-flow')).toBeVisible();
    
    // Check for graph controls
    await expect(page.locator('[title="Zoom in"]')).toBeVisible();
    await expect(page.locator('[title="Zoom out"]')).toBeVisible();
  });

  test('should navigate through pyramid by clicking layers', async ({ page }) => {
    // Click on L2 layer in pyramid
    await page.getByText('L2').click();
    
    // Should filter to L2 memories
    await page.waitForTimeout(500);
    
    // Verify L2 filter is active
    const activeFilter = page.locator('[data-active-layer]');
    await expect(activeFilter).toHaveText('L2');
  });

  test('should handle context filtering', async ({ page }) => {
    // Open context dropdown
    await page.getByText('Context').click();
    
    // Select a specific context
    const contextOptions = page.locator('[role="option"]');
    if (await contextOptions.count() > 1) {
      await contextOptions.nth(1).click();
      
      // Verify filter applied
      await page.waitForTimeout(500);
      const selectedContext = await contextOptions.nth(1).textContent();
      await expect(page.getByText(selectedContext || '')).toBeVisible();
    }
  });
});

test.describe('Memory Hierarchy API Integration', () => {
  test('should fetch hierarchy stats', async ({ request }) => {
    const response = await request.get(`${API_URL}/memories/hierarchy-stats`, {
      params: { user_id: 'test-user' },
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data).toHaveProperty('total_memories');
    expect(data).toHaveProperty('by_layer');
    expect(data.by_layer).toHaveProperty('L0');
    expect(data.by_layer).toHaveProperty('L1');
    expect(data.by_layer).toHaveProperty('L2');
    expect(data.by_layer).toHaveProperty('L3');
    expect(data.by_layer).toHaveProperty('L4');
  });

  test('should fetch memory graph', async ({ request }) => {
    // First get a memory ID
    const listResponse = await request.get(`${API_URL}/memories`, {
      params: { user_id: 'test-user', limit: 1 },
    });
    
    const memories = await listResponse.json();
    if (memories.length > 0) {
      const memoryId = memories[0].id;
      
      const graphResponse = await request.get(
        `${API_URL}/memories/${memoryId}/graph`,
        { params: { depth: 2 } }
      );
      
      expect(graphResponse.ok()).toBeTruthy();
      const graphData = await graphResponse.json();
      
      expect(graphData).toHaveProperty('nodes');
      expect(graphData).toHaveProperty('edges');
      expect(graphData).toHaveProperty('center');
    }
  });
});
