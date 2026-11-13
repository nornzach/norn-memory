"""Import canonical documents (like AGENTS.md) as L0 memories.

This module provides utilities to import structured documentation files
as L0 canonical memories, which serve as ground truth for the system.
"""

import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
import re

from norn_m.memory.hierarchy import MemoryLayer

logger = logging.getLogger(__name__)


def parse_agents_md(file_path: str) -> List[Dict[str, Any]]:
    """Parse AGENTS.md file into structured sections.
    
    AGENTS.md typically contains rules, conventions, and guidelines
    organized as markdown sections. Each meaningful section becomes
    a potential L0 memory.
    
    Args:
        file_path: Path to AGENTS.md file
    
    Returns:
        List of section dicts with 'title', 'content', 'level'
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    content = path.read_text(encoding='utf-8')
    
    # Parse markdown sections
    sections = []
    current_section = None
    current_content = []
    
    for line in content.split('\n'):
        # Check for headers (# Header, ## Subheader, etc.)
        header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        
        if header_match:
            # Save previous section
            if current_section:
                sections.append({
                    'title': current_section['title'],
                    'level': current_section['level'],
                    'content': '\n'.join(current_content).strip(),
                })
            
            # Start new section
            level = len(header_match.group(1))
            title = header_match.group(2).strip()
            current_section = {'title': title, 'level': level}
            current_content = []
        else:
            # Accumulate content
            if current_section:
                current_content.append(line)
    
    # Save last section
    if current_section and current_content:
        sections.append({
            'title': current_section['title'],
            'level': current_section['level'],
            'content': '\n'.join(current_content).strip(),
        })
    
    return sections


def extract_rules_from_section(section: Dict[str, Any]) -> List[str]:
    """Extract individual rules from a section.
    
    Rules can be:
    - Bullet points (- Rule)
    - Numbered lists (1. Rule)
    - Bold statements (**Rule**)
    - Paragraphs starting with imperatives (MUST, SHOULD, DO NOT, etc.)
    
    Args:
        section: Section dict with 'content'
    
    Returns:
        List of extracted rule strings
    """
    content = section.get('content', '')
    rules = []
    
    # Split into lines
    lines = content.split('\n')
    current_rule = []
    
    for line in lines:
        line = line.strip()
        if not line:
            # Empty line ends current rule
            if current_rule:
                rules.append(' '.join(current_rule))
                current_rule = []
            continue
        
        # Check if line starts a new rule
        is_bullet = line.startswith('-') or line.startswith('*')
        is_numbered = re.match(r'^\d+\.', line)
        is_imperative = any(line.startswith(word) for word in [
            'MUST', 'SHOULD', 'DO NOT', 'NEVER', 'ALWAYS',
            'DO', "DON'T", 'AVOID', 'PREFER', 'USE', 'ENSURE',
        ])
        
        if is_bullet or is_numbered or is_imperative:
            # Save previous rule
            if current_rule:
                rules.append(' '.join(current_rule))
            
            # Start new rule (strip bullet/number)
            if is_bullet:
                line = line[1:].strip()
            elif is_numbered:
                line = re.sub(r'^\d+\.\s*', '', line)
            
            current_rule = [line]
        else:
            # Continue current rule
            if current_rule:
                current_rule.append(line)
    
    # Save last rule
    if current_rule:
        rules.append(' '.join(current_rule))
    
    return [r for r in rules if r.strip() and len(r) > 10]  # Filter very short


def should_be_l0(section: Dict[str, Any], rule: str) -> bool:
    """Determine if a section/rule should be L0 canonical.
    
    L0 criteria:
    - Contains strong imperatives (MUST, NEVER)
    - Core principles or conventions
    - Project-wide rules
    - NOT implementation details or examples
    
    Args:
        section: Section containing the rule
        rule: The rule text
    
    Returns:
        True if should be L0
    """
    rule_upper = rule.upper()
    
    # Strong imperatives indicate L0
    strong_imperatives = ['MUST', 'NEVER', 'ALWAYS', 'REQUIRED', 'CRITICAL']
    if any(word in rule_upper for word in strong_imperatives):
        return True
    
    # Section titles indicating core rules
    title = section.get('title', '').lower()
    core_sections = ['rules', 'conventions', 'principles', 'critical', 'do not']
    if any(word in title for word in core_sections):
        return True
    
    # Avoid implementation details
    detail_keywords = ['example', 'for instance', 'e.g.', 'such as']
    if any(keyword in rule.lower() for keyword in detail_keywords):
        return False
    
    # Default to not L0 (be conservative)
    return False


def import_document_as_l0(
    file_path: str,
    memory_instance,
    user_id: str,
    metadata: Optional[Dict[str, Any]] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Import a document file as L0 canonical memories.
    
    Args:
        file_path: Path to document file (e.g., AGENTS.md)
        memory_instance: Memory or AsyncMemory instance
        user_id: User ID to associate memories with
        metadata: Additional metadata for memories
        dry_run: If True, only return what would be imported
    
    Returns:
        Dict with import statistics and imported memory IDs
    """
    stats = {
        'sections_parsed': 0,
        'rules_extracted': 0,
        'l0_candidates': 0,
        'imported': 0,
        'skipped': 0,
        'memory_ids': [],
        'dry_run': dry_run,
    }
    
    try:
        # Parse document
        sections = parse_agents_md(file_path)
        stats['sections_parsed'] = len(sections)
        
        logger.info(f"Parsed {len(sections)} sections from {file_path}")
        
        # Extract rules from each section
        all_rules = []
        for section in sections:
            rules = extract_rules_from_section(section)
            stats['rules_extracted'] += len(rules)
            
            for rule in rules:
                all_rules.append({
                    'section': section['title'],
                    'level': section['level'],
                    'rule': rule,
                    'is_l0': should_be_l0(section, rule),
                })
        
        # Filter L0 candidates
        l0_rules = [r for r in all_rules if r['is_l0']]
        stats['l0_candidates'] = len(l0_rules)
        
        logger.info(f"Found {len(l0_rules)} L0 candidates out of {len(all_rules)} rules")
        
        if dry_run:
            stats['preview'] = l0_rules[:10]  # First 10 for preview
            return stats
        
        # Import as L0 memories
        base_metadata = metadata or {}
        base_metadata.update({
            'source': 'document_import',
            'source_file': file_path,
            'layer': MemoryLayer.L0_CANONICAL.value,
            'importance': 10.0,  # L0 is always max importance
        })
        
        for rule_data in l0_rules:
            try:
                # Format memory text
                memory_text = f"[{rule_data['section']}] {rule_data['rule']}"
                
                # Add memory
                result = memory_instance.add(
                    messages=[{"role": "system", "content": memory_text}],
                    user_id=user_id,
                    metadata=base_metadata,
                    infer=False,  # Don't run LLM extraction on L0
                )
                
                if result.get('results'):
                    memory_id = result['results'][0].get('id')
                    stats['memory_ids'].append(memory_id)
                    stats['imported'] += 1
                else:
                    stats['skipped'] += 1
            
            except Exception as e:
                logger.error(f"Failed to import rule: {e}")
                stats['skipped'] += 1
        
        logger.info(f"Import complete: {stats['imported']} imported, {stats['skipped']} skipped")
    
    except Exception as e:
        logger.error(f"Document import failed: {e}")
        stats['error'] = str(e)
    
    return stats


def import_agents_md(
    repo_path: str,
    memory_instance,
    user_id: str,
    project_name: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Convenience function to import AGENTS.md from a repository.
    
    Args:
        repo_path: Path to repository root
        memory_instance: Memory instance
        user_id: User ID
        project_name: Project name (derived from repo if not provided)
        dry_run: Preview only
    
    Returns:
        Import statistics
    """
    repo_path_obj = Path(repo_path)
    agents_md = repo_path_obj / "AGENTS.md"
    
    if not agents_md.exists():
        return {
            'error': f"AGENTS.md not found in {repo_path}",
            'imported': 0,
        }
    
    if not project_name:
        project_name = repo_path_obj.name
    
    metadata = {
        'project': project_name,
        'context': f'project-{project_name}',
    }
    
    return import_document_as_l0(
        str(agents_md),
        memory_instance,
        user_id,
        metadata,
        dry_run,
    )
