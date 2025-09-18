'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    BarChart3,
    DollarSign,
    Download,
    FileText,
    Package,
    RefreshCw,
    Settings,
    Users
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface ERPDashboardProps {
  channelId: string;
}

interface ERPData {
  customers: number;
  orders: number;
  revenue: number;
  products: number;
  recentOrders: Array<{
    id: string;
    customer: string;
    amount: number;
    status: 'pending' | 'processing' | 'shipped' | 'delivered';
    date: string;
  }>;
  topProducts: Array<{
    id: string;
    name: string;
    sales: number;
    revenue: number;
  }>;
  inventoryAlerts: Array<{
    id: string;
    product: string;
    stock: number;
    threshold: number;
    status: 'low' | 'out' | 'critical';
  }>;
}

export function ERPDashboard({ channelId }: ERPDashboardProps) {
  const [erpData, setErpData] = useState<ERPData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Mock ERP data
  const mockERPData: ERPData = {
    customers: 1247,
    orders: 89,
    revenue: 125430,
    products: 156,
    recentOrders: [
      {
        id: 'ORD-001',
        customer: 'ABC Corporation',
        amount: 2500,
        status: 'processing',
        date: '2024-09-18T10:30:00Z'
      },
      {
        id: 'ORD-002',
        customer: 'XYZ Ltd',
        amount: 1800,
        status: 'shipped',
        date: '2024-09-17T14:20:00Z'
      },
      {
        id: 'ORD-003',
        customer: 'Tech Solutions Inc',
        amount: 3200,
        status: 'delivered',
        date: '2024-09-16T09:15:00Z'
      },
      {
        id: 'ORD-004',
        customer: 'Global Industries',
        amount: 1500,
        status: 'pending',
        date: '2024-09-15T16:45:00Z'
      }
    ],
    topProducts: [
      {
        id: 'PROD-001',
        name: 'Enterprise Software License',
        sales: 45,
        revenue: 67500
      },
      {
        id: 'PROD-002',
        name: 'Cloud Storage Package',
        sales: 32,
        revenue: 25600
      },
      {
        id: 'PROD-003',
        name: 'Technical Support Plan',
        sales: 28,
        revenue: 16800
      }
    ],
    inventoryAlerts: [
      {
        id: 'ALERT-001',
        product: 'Server Hardware',
        stock: 5,
        threshold: 10,
        status: 'low'
      },
      {
        id: 'ALERT-002',
        product: 'Network Cables',
        stock: 0,
        threshold: 50,
        status: 'out'
      },
      {
        id: 'ALERT-003',
        product: 'Software Licenses',
        stock: 2,
        threshold: 20,
        status: 'critical'
      }
    ]
  };

  useEffect(() => {
    // Simulate API call
    const fetchERPData = async () => {
      setIsLoading(true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      setErpData(mockERPData);
      setLastSync(new Date());
      setIsLoading(false);
    };

    fetchERPData();
  }, []);

  const handleSync = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLastSync(new Date());
    setIsLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      case 'processing':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'shipped':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
      case 'delivered':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'low':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      case 'out':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'critical':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading && !erpData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400">Loading ERP data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            ERP Dashboard
          </h2>
          <Badge variant="outline" className="text-xs">
            {channelId}
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Sync
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Last Sync Info */}
      {lastSync && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Last synced: {lastSync.toLocaleString()}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {erpData?.customers.toLocaleString()}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Total Customers
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <FileText className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {erpData?.orders}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Active Orders
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(erpData?.revenue || 0)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Total Revenue
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Package className="w-8 h-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {erpData?.products}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Products
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="orders">Recent Orders</TabsTrigger>
          <TabsTrigger value="products">Top Products</TabsTrigger>
          <TabsTrigger value="inventory">Inventory Alerts</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Recent Orders */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {erpData?.recentOrders.map(order => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                        <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {order.id}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {order.customer}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatCurrency(order.amount)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(order.date)}
                        </p>
                      </div>
                      <Badge className={getStatusColor(order.status)}>
                        {order.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Products */}
        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top Selling Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {erpData?.topProducts.map((product, index) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {index + 1}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {product.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {product.sales} sales
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(product.revenue)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Revenue
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Alerts */}
        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Inventory Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {erpData?.inventoryAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
                        <Package className="w-5 h-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {alert.product}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Stock: {alert.stock} / {alert.threshold}
                        </p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(alert.status)}>
                      {alert.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sales Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <BarChart3 className="w-12 h-12 mx-auto mb-2" />
                <p>Analytics charts coming soon</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
