"""Unit tests for memory hierarchy module."""

from datetime import datetime, timedelta, timezone

from norn_m.memory.hierarchy import (
    MemoryLayer,
    LAYER_BASE_WEIGHTS,
    LAYER_DECAY_FACTORS,
    calculate_recency,
    calculate_weight,
    assign_initial_layer,
    should_promote,
    should_demote,
    validate_importance,
)


class TestMemoryLayer:
    """Test MemoryLayer enum and constants."""
    
    def test_layer_enum_values(self):
        """Test that all layer enum values are correct."""
        assert MemoryLayer.L0_CANONICAL.value == "L0"
        assert MemoryLayer.L1_CORE.value == "L1"
        assert MemoryLayer.L2_EPISODIC.value == "L2"
        assert MemoryLayer.L3_WORKING.value == "L3"
        assert MemoryLayer.L4_TRANSIENT.value == "L4"
    
    def test_layer_base_weights(self):
        """Test that base weights are ordered correctly."""
        assert LAYER_BASE_WEIGHTS[MemoryLayer.L0_CANONICAL] == 10.0
        assert LAYER_BASE_WEIGHTS[MemoryLayer.L1_CORE] == 8.0
        assert LAYER_BASE_WEIGHTS[MemoryLayer.L2_EPISODIC] == 5.0
        assert LAYER_BASE_WEIGHTS[MemoryLayer.L3_WORKING] == 2.5
        assert LAYER_BASE_WEIGHTS[MemoryLayer.L4_TRANSIENT] == 1.0
        
        # Verify ordering
        weights = [LAYER_BASE_WEIGHTS[layer] for layer in MemoryLayer]
        assert weights == sorted(weights, reverse=True)
    
    def test_layer_decay_factors(self):
        """Test that decay factors are reasonable."""
        # L0 never decays
        assert LAYER_DECAY_FACTORS[MemoryLayer.L0_CANONICAL] == 1.0
        
        # Others decay at different rates
        assert 0.9 < LAYER_DECAY_FACTORS[MemoryLayer.L1_CORE] < 1.0
        assert 0.9 < LAYER_DECAY_FACTORS[MemoryLayer.L2_EPISODIC] < 1.0
        assert 0.9 < LAYER_DECAY_FACTORS[MemoryLayer.L3_WORKING] < 1.0
        
        # L4 decays fastest
        assert LAYER_DECAY_FACTORS[MemoryLayer.L4_TRANSIENT] == 0.5


class TestRecencyCalculation:
    """Test recency calculation and decay."""
    
    def test_recency_immediate(self):
        """Test recency for just-accessed memory."""
        now = datetime.now(timezone.utc)
        recency = calculate_recency(now, now, MemoryLayer.L3_WORKING)
        assert recency == 1.0
    
    def test_recency_one_hour_ago(self):
        """Test recency for memory accessed 1 hour ago."""
        now = datetime.now(timezone.utc)
        one_hour_ago = now - timedelta(hours=1)
        
        # L3 should have noticeable decay
        recency_l3 = calculate_recency(one_hour_ago, now, MemoryLayer.L3_WORKING)
        assert 0.9 < recency_l3 < 1.0
        
        # L4 should decay significantly (half-life ~1 hour)
        recency_l4 = calculate_recency(one_hour_ago, now, MemoryLayer.L4_TRANSIENT)
        assert 0.4 < recency_l4 < 0.6
    
    def test_recency_one_day_ago(self):
        """Test recency for memory accessed 1 day ago."""
        now = datetime.now(timezone.utc)
        one_day_ago = now - timedelta(days=1)
        
        recency_l1 = calculate_recency(one_day_ago, now, MemoryLayer.L1_CORE)
        recency_l2 = calculate_recency(one_day_ago, now, MemoryLayer.L2_EPISODIC)
        recency_l3 = calculate_recency(one_day_ago, now, MemoryLayer.L3_WORKING)
        
        # L1 should decay slowly
        assert recency_l1 > 0.9
        
        # L2 should decay moderately
        assert 0.95 < recency_l2 < 0.99
        
        # L3 should decay faster
        assert 0.0 < recency_l3 < 0.8
    
    def test_recency_l0_never_decays(self):
        """Test that L0 canonical memories never decay."""
        now = datetime.now(timezone.utc)
        long_ago = now - timedelta(days=365)
        
        recency = calculate_recency(long_ago, now, MemoryLayer.L0_CANONICAL)
        assert recency == 1.0
    
    def test_recency_timezone_aware(self):
        """Test that recency calculation handles timezones."""
        now = datetime.now(timezone.utc)
        one_hour_ago = now - timedelta(hours=1)
        
        # Should work with timezone-aware datetimes
        recency = calculate_recency(one_hour_ago, now, MemoryLayer.L2_EPISODIC)
        assert 0 < recency <= 1.0
    
    def test_recency_clamped_to_range(self):
        """Test that recency is always in [0, 1] range."""
        now = datetime.now(timezone.utc)
        very_long_ago = now - timedelta(days=3650)  # 10 years
        
        for layer in MemoryLayer:
            recency = calculate_recency(very_long_ago, now, layer)
            assert 0.0 <= recency <= 1.0


class TestWeightCalculation:
    """Test composite weight calculation."""
    
    def test_weight_max_values(self):
        """Test weight with maximum importance and recency."""
        now = datetime.now(timezone.utc)
        
        # L0 with max importance, just accessed
        weight = calculate_weight(MemoryLayer.L0_CANONICAL, 10.0, now, now)
        assert weight == 10.0  # 10.0 * 1.0 * 1.0
    
    def test_weight_decreases_with_time(self):
        """Test that weight decreases as memory ages."""
        now = datetime.now(timezone.utc)
        one_day_ago = now - timedelta(days=1)
        one_week_ago = now - timedelta(days=7)
        
        recent_weight = calculate_weight(MemoryLayer.L2_EPISODIC, 8.0, one_day_ago, now)
        old_weight = calculate_weight(MemoryLayer.L2_EPISODIC, 8.0, one_week_ago, now)
        
        assert recent_weight > old_weight
    
    def test_weight_increases_with_importance(self):
        """Test that weight increases with importance."""
        now = datetime.now(timezone.utc)
        
        low_weight = calculate_weight(MemoryLayer.L2_EPISODIC, 3.0, now, now)
        high_weight = calculate_weight(MemoryLayer.L2_EPISODIC, 9.0, now, now)
        
        assert high_weight > low_weight
    
    def test_weight_increases_with_layer(self):
        """Test that higher layers have higher weights."""
        now = datetime.now(timezone.utc)
        
        l1_weight = calculate_weight(MemoryLayer.L1_CORE, 7.0, now, now)
        l3_weight = calculate_weight(MemoryLayer.L3_WORKING, 7.0, now, now)
        
        assert l1_weight > l3_weight


class TestLayerAssignment:
    """Test initial layer assignment based on importance."""
    
    def test_assign_low_importance(self):
        """Test that low importance goes to L4."""
        assert assign_initial_layer(1.0) == MemoryLayer.L4_TRANSIENT
        assert assign_initial_layer(2.5) == MemoryLayer.L4_TRANSIENT
    
    def test_assign_medium_low_importance(self):
        """Test that medium-low importance goes to L3."""
        assert assign_initial_layer(3.0) == MemoryLayer.L3_WORKING
        assert assign_initial_layer(4.5) == MemoryLayer.L3_WORKING
    
    def test_assign_medium_importance(self):
        """Test that medium importance goes to L2."""
        assert assign_initial_layer(5.0) == MemoryLayer.L2_EPISODIC
        assert assign_initial_layer(6.5) == MemoryLayer.L2_EPISODIC
        assert assign_initial_layer(7.5) == MemoryLayer.L2_EPISODIC
    
    def test_assign_high_importance(self):
        """Test that high importance goes to L1."""
        assert assign_initial_layer(8.0) == MemoryLayer.L1_CORE
        assert assign_initial_layer(9.5) == MemoryLayer.L1_CORE
        assert assign_initial_layer(10.0) == MemoryLayer.L1_CORE
    
    def test_assign_boundary_values(self):
        """Test layer assignment at boundary values."""
        # Just below thresholds
        assert assign_initial_layer(2.99) == MemoryLayer.L4_TRANSIENT
        assert assign_initial_layer(4.99) == MemoryLayer.L3_WORKING
        assert assign_initial_layer(7.99) == MemoryLayer.L2_EPISODIC
        
        # Just at thresholds
        assert assign_initial_layer(3.0) == MemoryLayer.L3_WORKING
        assert assign_initial_layer(5.0) == MemoryLayer.L2_EPISODIC
        assert assign_initial_layer(8.0) == MemoryLayer.L1_CORE


class TestPromotion:
    """Test memory promotion logic."""
    
    def test_promote_l4_to_l3(self):
        """Test L4 → L3 promotion when accessed frequently."""
        # L4 with 3+ accesses should promote
        result = should_promote(MemoryLayer.L4_TRANSIENT, access_count=3, age_hours=1)
        assert result == MemoryLayer.L3_WORKING
        
        # L4 with <3 accesses should not promote
        result = should_promote(MemoryLayer.L4_TRANSIENT, access_count=2, age_hours=1)
        assert result is None
    
    def test_promote_l3_to_l2(self):
        """Test L3 → L2 promotion."""
        # L3 with 3+ accesses should promote
        result = should_promote(MemoryLayer.L3_WORKING, access_count=3, age_hours=10)
        assert result == MemoryLayer.L2_EPISODIC
        
        # L3 older than 7 days should promote
        result = should_promote(MemoryLayer.L3_WORKING, access_count=1, age_hours=168)
        assert result == MemoryLayer.L2_EPISODIC
        
        # L3 with low access and young age should not promote
        result = should_promote(MemoryLayer.L3_WORKING, access_count=2, age_hours=10)
        assert result is None
    
    def test_no_auto_promote_l2_to_l1(self):
        """Test that L2 → L1 requires reflection, not automatic."""
        result = should_promote(MemoryLayer.L2_EPISODIC, access_count=100, age_hours=1000)
        assert result is None
    
    def test_no_auto_promote_l1_to_l0(self):
        """Test that L1 → L0 requires explicit user action."""
        result = should_promote(MemoryLayer.L1_CORE, access_count=1000, age_hours=10000)
        assert result is None


class TestDemotion:
    """Test memory demotion logic."""
    
    def test_demote_l4_archive(self):
        """Test L4 should be archived after 7 days inactive."""
        result = should_demote(MemoryLayer.L4_TRANSIENT, hours_since_access=168, importance=2.0)
        assert result is None  # None means archive/delete
        
        # High importance L4 should not be archived
        result = should_demote(MemoryLayer.L4_TRANSIENT, hours_since_access=168, importance=8.0)
        assert result == MemoryLayer.L4_TRANSIENT  # Stay
    
    def test_demote_l3_to_l4(self):
        """Test L3 → L4 demotion after inactivity."""
        result = should_demote(MemoryLayer.L3_WORKING, hours_since_access=168, importance=3.0)
        assert result == MemoryLayer.L4_TRANSIENT
        
        # Higher importance should prevent demotion
        result = should_demote(MemoryLayer.L3_WORKING, hours_since_access=168, importance=5.0)
        assert result == MemoryLayer.L3_WORKING
    
    def test_demote_l2_to_l3(self):
        """Test L2 → L3 demotion after long inactivity."""
        result = should_demote(MemoryLayer.L2_EPISODIC, hours_since_access=720, importance=4.0)
        assert result == MemoryLayer.L3_WORKING
        
        # Higher importance should prevent demotion
        result = should_demote(MemoryLayer.L2_EPISODIC, hours_since_access=720, importance=6.0)
        assert result == MemoryLayer.L2_EPISODIC
    
    def test_no_auto_demote_l1_l0(self):
        """Test that L1 and L0 never auto-demote."""
        result = should_demote(MemoryLayer.L1_CORE, hours_since_access=10000, importance=1.0)
        assert result == MemoryLayer.L1_CORE
        
        result = should_demote(MemoryLayer.L0_CANONICAL, hours_since_access=10000, importance=1.0)
        assert result == MemoryLayer.L0_CANONICAL


class TestImportanceValidation:
    """Test importance score validation."""
    
    def test_validate_in_range(self):
        """Test that valid values pass through."""
        assert validate_importance(5.0) == 5.0
        assert validate_importance(1.0) == 1.0
        assert validate_importance(10.0) == 10.0
    
    def test_validate_clamp_low(self):
        """Test that values below 1 are clamped."""
        assert validate_importance(0.0) == 1.0
        assert validate_importance(-5.0) == 1.0
    
    def test_validate_clamp_high(self):
        """Test that values above 10 are clamped."""
        assert validate_importance(11.0) == 10.0
        assert validate_importance(100.0) == 10.0
    
    def test_validate_preserves_precision(self):
        """Test that decimal precision is preserved."""
        assert validate_importance(7.5) == 7.5
        assert validate_importance(3.14159) == 3.14159
