import { randomInt } from 'crypto';

export class TestDataGenerator {
  private static readonly REGIONS = ['North America', 'Europe', 'Asia', 'South America', 'Africa'];
  private static readonly PRODUCTS = ['Product A', 'Product B', 'Product C', 'Product D', 'Product E'];
  private static readonly MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  generateSmallDataset(size: number = 100): any[] {
    return Array(size).fill(null).map((_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 1000,
      category: this.getRandomCategory(),
      timestamp: new Date(Date.now() - randomInt(0, 30 * 24 * 60 * 60 * 1000)).toISOString()
    }));
  }

  generateMediumDataset(size: number = 1000): any[] {
    return Array(size).fill(null).map((_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 10000,
      category: this.getRandomCategory(),
      region: this.getRandomRegion(),
      product: this.getRandomProduct(),
      quantity: randomInt(1, 100),
      timestamp: new Date(Date.now() - randomInt(0, 90 * 24 * 60 * 60 * 1000)).toISOString(),
      metadata: {
        source: 'test-generator',
        version: '1.0',
        tags: [this.getRandomTag(), this.getRandomTag()]
      }
    }));
  }

  generateLargeDataset(size: number = 10000): any[] {
    return Array(size).fill(null).map((_, i) => ({
      id: i + 1,
      name: `Large Item ${i + 1}`,
      value: Math.random() * 100000,
      category: this.getRandomCategory(),
      region: this.getRandomRegion(),
      product: this.getRandomProduct(),
      quantity: randomInt(1, 1000),
      revenue: Math.random() * 50000,
      cost: Math.random() * 30000,
      profit: Math.random() * 20000,
      margin: Math.random() * 0.3 + 0.1,
      timestamp: new Date(Date.now() - randomInt(0, 365 * 24 * 60 * 60 * 1000)).toISOString(),
      customerInfo: {
        id: `customer-${randomInt(1, 1000)}`,
        segment: this.getRandomSegment(),
        loyalty: this.getRandomLoyaltyTier()
      },
      salesInfo: {
        representative: `Rep ${randomInt(1, 50)}`,
        channel: this.getRandomChannel(),
        campaign: this.getRandomCampaign()
      },
      metadata: {
        source: 'large-test-generator',
        version: '2.0',
        tags: [this.getRandomTag(), this.getRandomTag(), this.getRandomTag()],
        quality: Math.random() > 0.1 ? 'good' : 'needs-review'
      }
    }));
  }

  generateChartData(points: number = 50): any[] {
    const now = new Date();
    return Array(points).fill(null).map((_, i) => {
      const date = new Date(now.getTime() - (points - i) * 24 * 60 * 60 * 1000);
      return {
        x: date.toISOString().split('T')[0],
        y: Math.random() * 100 + 50 + Math.sin(i / 5) * 20,
        category: this.getRandomCategory(),
        metadata: {
          confidence: Math.random() * 0.3 + 0.7,
          source: 'chart-generator'
        }
      };
    });
  }

  generateTimeSeriesData(points: number = 100): any[] {
    const now = Date.now();
    const interval = 60000; // 1 minute intervals

    return Array(points).fill(null).map((_, i) => ({
      timestamp: new Date(now - (points - i) * interval).toISOString(),
      value: 100 + Math.sin(i / 10) * 30 + Math.random() * 20,
      volume: Math.random() * 1000 + 500,
      trend: Math.sin(i / 20) > 0 ? 'up' : 'down',
      metadata: {
        sensor: `sensor-${randomInt(1, 10)}`,
        quality: Math.random() > 0.05 ? 'good' : 'poor'
      }
    }));
  }

  generateSalesData(months: number = 12): any[] {
    return Array(months).fill(null).map((_, i) => ({
      month: TestDataGenerator.MONTHS[i % 12],
      year: 2024,
      sales: Math.random() * 100000 + 50000,
      target: Math.random() * 120000 + 60000,
      region: this.getRandomRegion(),
      product: this.getRandomProduct(),
      growth: (Math.random() - 0.3) * 0.4, // -30% to +10% growth
      margin: Math.random() * 0.3 + 0.15
    }));
  }

  generateCustomerData(count: number = 500): any[] {
    return Array(count).fill(null).map((_, i) => ({
      id: `customer-${i + 1}`,
      name: `Customer ${i + 1}`,
      email: `customer${i + 1}@example.com`,
      segment: this.getRandomSegment(),
      tier: this.getRandomLoyaltyTier(),
      totalSpent: Math.random() * 10000 + 100,
      orderCount: randomInt(1, 100),
      avgOrderValue: Math.random() * 500 + 50,
      lastOrderDate: new Date(Date.now() - randomInt(0, 365 * 24 * 60 * 60 * 1000)).toISOString(),
      registrationDate: new Date(Date.now() - randomInt(30, 365 * 24 * 60 * 60 * 1000)).toISOString(),
      preferences: {
        category: this.getRandomCategory(),
        communication: this.getRandomCommunicationPreference(),
        frequency: this.getRandomFrequency()
      },
      address: {
        region: this.getRandomRegion(),
        country: this.getRandomCountry()
      }
    }));
  }

  generateFormFields(fieldCount: number = 10): any[] {
    const fieldTypes = ['text', 'email', 'number', 'select', 'checkbox', 'radio', 'textarea', 'date'];
    const fields: any[] = [];

    for (let i = 0; i < fieldCount; i++) {
      const type = fieldTypes[randomInt(0, fieldTypes.length)];
      const field = {
        id: `field-${i + 1}`,
        name: `field_${i + 1}`,
        label: `Field ${i + 1}`,
        type: type,
        required: Math.random() > 0.7
      };

      // Add type-specific properties
      switch (type) {
        case 'select':
        case 'radio':
          field.options = this.generateOptions(randomInt(2, 6));
          break;
        case 'number':
          field.min = randomInt(0, 100);
          field.max = randomInt(200, 1000);
          field.step = randomInt(1, 10);
          break;
        case 'textarea':
          field.rows = randomInt(3, 8);
          field.maxLength = randomInt(100, 1000);
          break;
      }

      fields.push(field);
    }

    return fields;
  }

  generateWorkflowConfig(): any {
    return {
      name: `test-workflow-${Date.now()}`,
      description: 'Generated test workflow',
      steps: [
        {
          id: 'data-collection',
          name: 'Collect Data',
          type: 'automated',
          estimatedDuration: randomInt(5, 30) * 1000
        },
        {
          id: 'data-analysis',
          name: 'Analyze Data',
          type: 'automated',
          estimatedDuration: randomInt(10, 60) * 1000
        },
        {
          id: 'human-review',
          name: 'Human Review',
          type: 'hitl',
          estimatedDuration: randomInt(30, 300) * 1000
        },
        {
          id: 'final-approval',
          name: 'Final Approval',
          type: 'hitl',
          estimatedDuration: randomInt(15, 120) * 1000
        }
      ],
      config: {
        timeoutMs: randomInt(5, 30) * 60 * 1000, // 5-30 minutes
        retryAttempts: randomInt(1, 5),
        enableNotifications: Math.random() > 0.5
      }
    };
  }

  generateUIComponentConfig(): any {
    const componentTypes = ['dashboard', 'form', 'chart', 'table', 'report'];
    const type = componentTypes[randomInt(0, componentTypes.length)];

    const baseConfig = {
      id: `ui-component-${Date.now()}`,
      type: type,
      title: `Generated ${type}`,
      responsive: true,
      theme: Math.random() > 0.5 ? 'light' : 'dark'
    };

    switch (type) {
      case 'dashboard':
        return {
          ...baseConfig,
          layout: 'grid',
          components: ['chart', 'table', 'filters'],
          data: this.generateMediumDataset(500)
        };
      case 'form':
        return {
          ...baseConfig,
          fields: this.generateFormFields(randomInt(5, 15)),
          validation: {
            enableRealTime: true,
            showErrorSummary: true
          }
        };
      case 'chart':
        return {
          ...baseConfig,
          chartType: Math.random() > 0.5 ? 'bar' : 'line',
          data: this.generateChartData(100),
          interactive: true
        };
      case 'table':
        return {
          ...baseConfig,
          columns: this.generateTableColumns(),
          data: this.generateMediumDataset(200),
          sortable: true,
          filterable: true
        };
      case 'report':
        return {
          ...baseConfig,
          sections: ['summary', 'details', 'charts', 'recommendations'],
          data: this.generateSalesData(12),
          exportable: true
        };
      default:
        return baseConfig;
    }
  }

  private getRandomCategory(): string {
    const categories = ['Electronics', 'Clothing', 'Food', 'Books', 'Home', 'Sports'];
    return categories[randomInt(0, categories.length)];
  }

  private getRandomRegion(): string {
    return TestDataGenerator.REGIONS[randomInt(0, TestDataGenerator.REGIONS.length)];
  }

  private getRandomProduct(): string {
    return TestDataGenerator.PRODUCTS[randomInt(0, TestDataGenerator.PRODUCTS.length)];
  }

  private getRandomSegment(): string {
    const segments = ['Enterprise', 'Small Business', 'Consumer', 'Government', 'Education'];
    return segments[randomInt(0, segments.length)];
  }

  private getRandomLoyaltyTier(): string {
    const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum'];
    return tiers[randomInt(0, tiers.length)];
  }

  private getRandomChannel(): string {
    const channels = ['Online', 'Retail', 'Partner', 'Direct', 'Mobile'];
    return channels[randomInt(0, channels.length)];
  }

  private getRandomCampaign(): string {
    const campaigns = ['Spring Sale', 'Summer Promotion', 'Fall Campaign', 'Winter Special', 'New Launch'];
    return campaigns[randomInt(0, campaigns.length)];
  }

  private getRandomTag(): string {
    const tags = ['featured', 'new', 'popular', 'limited', 'exclusive', 'seasonal'];
    return tags[randomInt(0, tags.length)];
  }

  private getRandomCommunicationPreference(): string {
    const preferences = ['email', 'sms', 'push', 'mail', 'phone'];
    return preferences[randomInt(0, preferences.length)];
  }

  private getRandomFrequency(): string {
    const frequencies = ['daily', 'weekly', 'monthly', 'quarterly'];
    return frequencies[randomInt(0, frequencies.length)];
  }

  private getRandomCountry(): string {
    const countries = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Japan', 'Australia'];
    return countries[randomInt(0, countries.length)];
  }

  private generateOptions(count: number): string[] {
    return Array(count).fill(null).map((_, i) => `Option ${i + 1}`);
  }

  private generateTableColumns(): any[] {
    return [
      { id: 'name', label: 'Name', sortable: true },
      { id: 'value', label: 'Value', sortable: true, type: 'number' },
      { id: 'category', label: 'Category', filterable: true },
      { id: 'region', label: 'Region', filterable: true },
      { id: 'date', label: 'Date', sortable: true, type: 'date' }
    ];
  }
}