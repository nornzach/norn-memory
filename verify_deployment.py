#!/usr/bin/env python3
"""
Norn-M 部署验证脚本

验证所有组件是否正确部署并符合安全要求。
"""

import os
import sys
from pathlib import Path

# 颜色输出
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def check(name: str, condition: bool, details: str = "") -> bool:
    """检查并打印结果"""
    if condition:
        print(f"{GREEN}✅ {name}{RESET}")
        if details:
            print(f"   {details}")
        return True
    else:
        print(f"{RED}❌ {name}{RESET}")
        if details:
            print(f"   {details}")
        return False


def main():
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}Norn-M 部署验证{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")
    
    results = []
    
    # 1. 文件完整性检查
    print(f"{BLUE}1. 文件完整性检查{RESET}")
    print("-" * 60)
    
    critical_files = {
        "后端模块": [
            "norn_m/memory/hierarchy.py",
            "norn_m/memory/context.py",
            "norn_m/memory/reflection.py",
            "norn_m/memory/conflict.py",
            "norn_m/memory/tasks.py",
            "norn_m/memory/document_import.py",
        ],
        "安全组件": [
            "server/security.py",
            "server/routers/hierarchy.py",
            "docs/SECURITY-AUDIT.md",
            "docs/SECURITY-SUMMARY.md",
        ],
        "测试文件": [
            "tests/memory/test_hierarchy.py",
            "tests/memory/test_context.py",
            "tests/memory/test_reflection.py",
        ],
        "前端组件": [
            "server/dashboard/src/components/memories/HierarchyPyramid.tsx",
            "server/dashboard/src/components/memories/HierarchyFilters.tsx",
            "server/dashboard/src/components/memories/MemoryGraph.tsx",
            "server/dashboard/src/components/memories/ConflictDetectionUI.tsx",
            "server/dashboard/src/components/memories/MemoryBatchActions.tsx",
            "server/dashboard/src/components/memories/MemoryDetailView.tsx",
        ],
    }
    
    for category, files in critical_files.items():
        print(f"\n{category}:")
        for filepath in files:
            exists = os.path.exists(filepath)
            size = os.path.getsize(filepath) if exists else 0
            results.append(check(
                filepath,
                exists,
                f"({size/1024:.1f}KB)" if exists else "文件不存在"
            ))
    
    # 2. 安全配置检查
    print(f"\n{BLUE}2. 安全配置检查{RESET}")
    print("-" * 60)
    
    hierarchy_file = "server/routers/hierarchy.py"
    if os.path.exists(hierarchy_file):
        with open(hierarchy_file, 'r') as f:
            content = f.read()
        
        security_checks = {
            "API key验证": "get_key_scope" in content,
            "Scope权限检查": "scope.user_ids" in content,
            "403错误处理": "403" in content,
            "安全日志": "SECURITY" in content or "logger" in content,
            "输入验证": "HTTPException" in content,
        }
        
        for check_name, passed in security_checks.items():
            results.append(check(check_name, passed))
    else:
        print(f"{RED}hierarchy.py 文件不存在{RESET}")
        results.append(False)
    
    # 3. 代码质量检查
    print(f"\n{BLUE}3. 代码质量检查{RESET}")
    print("-" * 60)
    
    # 检查测试文件
    test_files = [
        "tests/memory/test_hierarchy.py",
        "tests/memory/test_context.py",
        "tests/memory/test_reflection.py",
    ]
    
    test_count = 0
    for test_file in test_files:
        if os.path.exists(test_file):
            with open(test_file, 'r') as f:
                content = f.read()
            count = content.count("def test_")
            test_count += count
            results.append(check(
                f"{test_file}",
                count > 0,
                f"包含 {count} 个测试"
            ))
    
    print(f"\n   总测试数: {test_count}")
    
    # 4. 文档完整性检查
    print(f"\n{BLUE}4. 文档完整性检查{RESET}")
    print("-" * 60)
    
    docs = {
        "架构设计": "docs/memory-hierarchy-design.md",
        "实施计划": "docs/memory-hierarchy-implementation.md",
        "安全审计": "docs/SECURITY-AUDIT.md",
        "安全摘要": "docs/SECURITY-SUMMARY.md",
        "胜利报告": "docs/victory-report.md",
    }
    
    total_doc_size = 0
    for doc_name, doc_path in docs.items():
        if os.path.exists(doc_path):
            size = os.path.getsize(doc_path)
            total_doc_size += size
            results.append(check(
                doc_name,
                size > 0,
                f"{size/1024:.1f}KB"
            ))
        else:
            results.append(check(doc_name, False, "文件不存在"))
    
    print(f"\n   总文档大小: {total_doc_size/1024:.1f}KB")
    
    # 5. 前端组件检查
    print(f"\n{BLUE}5. 前端组件检查{RESET}")
    print("-" * 60)
    
    frontend_components = [
        "HierarchyPyramid.tsx",
        "HierarchyFilters.tsx",
        "MemoryGraph.tsx",
        "ConflictDetectionUI.tsx",
        "MemoryBatchActions.tsx",
        "MemoryDetailView.tsx",
    ]
    
    component_dir = "server/dashboard/src/components/memories"
    for component in frontend_components:
        path = f"{component_dir}/{component}"
        exists = os.path.exists(path)
        size = os.path.getsize(path) if exists else 0
        results.append(check(
            component,
            exists,
            f"{size/1024:.1f}KB" if exists else "文件不存在"
        ))
    
    # 6. 总结
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}部署验证总结{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")
    
    passed = sum(results)
    total = len(results)
    percentage = (passed / total * 100) if total > 0 else 0
    
    print(f"通过检查: {passed}/{total} ({percentage:.1f}%)")
    
    if percentage == 100:
        print(f"\n{GREEN}🎉 所有检查通过！系统已就绪！{RESET}")
        return 0
    elif percentage >= 90:
        print(f"\n{YELLOW}⚠️  大部分检查通过，但有少量问题需要处理{RESET}")
        return 1
    else:
        print(f"\n{RED}❌ 多个检查失败，请修复问题后重试{RESET}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
